from bson import ObjectId
from fastapi import HTTPException, status

from core.config import settings
from core.database import (
    families_collection,
    family_members_collection,
    invite_codes_collection,
    users_collection,
)
from models.family import (
    create_family_document,
    create_family_member_document,
    create_invite_document,
    utc_now,
)


# ─── Create family ────────────────────────────────────────────

def create_family(name: str, admin_user_id: str) -> dict:
    """Create a new family and add the creator as the first member."""

    # Check user is not already in a family
    existing = family_members_collection.find_one({"user_id": admin_user_id})
    if existing:
        raise ValueError("You are already a member of a family.")

    family_doc = create_family_document(name=name, admin_user_id=admin_user_id)
    result = families_collection.insert_one(family_doc)
    family_id = str(result.inserted_id)

    # Add creator as first member
    member_doc = create_family_member_document(
        family_id=family_id,
        user_id=admin_user_id,
    )
    family_members_collection.insert_one(member_doc)

    family_doc["_id"] = result.inserted_id
    return family_doc


# ─── Get user's family ─────────────────────────────────────────

def get_user_family(user_id: str) -> dict | None:
    """Return the family the user belongs to, or None."""
    membership = family_members_collection.find_one({"user_id": user_id})
    if not membership:
        return None
    family = families_collection.find_one({"_id": ObjectId(membership["family_id"])})
    return family


# ─── Get family members ────────────────────────────────────────

def get_family_members(family_id: str) -> list[dict]:
    """Return enriched member list (user info + joined_at)."""
    memberships = list(family_members_collection.find({"family_id": family_id}))
    members = []
    for m in memberships:
        user = users_collection.find_one({"_id": ObjectId(m["user_id"])})
        if user:
            members.append({
                "id": str(user["_id"]),
                "name": user["name"],
                "email": user["email"],
                "joined_at": m["joined_at"],
            })
    return members


# ─── Generate / retrieve invite ────────────────────────────────

def generate_invite(family_id: str, created_by: str) -> dict:
    """
    Return an existing non-expired invite for this family,
    or create a fresh one.
    """
    now = utc_now()

    # Look for an existing valid invite for this family
    existing = invite_codes_collection.find_one({
        "family_id": family_id,
        "expires_at": {"$gt": now},
    })

    if existing:
        return existing

    # Create a new invite
    invite_doc = create_invite_document(
        family_id=family_id,
        created_by=created_by,
    )
    result = invite_codes_collection.insert_one(invite_doc)
    invite_doc["_id"] = result.inserted_id
    return invite_doc


def get_invite_url(invite_code: str) -> str:
    frontend_url = settings.frontend_url.rstrip("/")
    return f"{frontend_url}?invite={invite_code}"


# ─── Validate invite code ──────────────────────────────────────

def validate_invite_code(code: str) -> dict:
    """Return invite doc if code is valid, raise 400 if not."""
    now = utc_now()
    invite = invite_codes_collection.find_one({
        "code": code,
        "expires_at": {"$gt": now},
    })
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite code is invalid or has expired.",
        )
    return invite


# ─── Join family ───────────────────────────────────────────────

def join_family_by_code(invite_code: str, user_id: str) -> dict:
    """Add user to a family using an invite code."""

    # Check not already in a family
    existing_membership = family_members_collection.find_one({"user_id": user_id})
    if existing_membership:
        # Already in this family?
        if existing_membership["family_id"] == invite_code:
            raise ValueError("You are already a member of this family.")
        raise ValueError("You are already a member of another family.")

    invite = validate_invite_code(invite_code)
    family_id = invite["family_id"]

    # Verify family exists
    family = families_collection.find_one({"_id": ObjectId(family_id)})
    if not family:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Family no longer exists.",
        )

    member_doc = create_family_member_document(
        family_id=family_id,
        user_id=user_id,
    )
    family_members_collection.insert_one(member_doc)
    return family


# ─── Remove member ─────────────────────────────────────────────

def remove_member(family_id: str, requester_id: str, target_user_id: str) -> dict | None:
    """Remove a member from family. Returns updated family dict, or None if family dissolved."""
    family = families_collection.find_one({"_id": ObjectId(family_id)})
    if not family:
        raise ValueError("Family not found.")

    if family.get("admin_user_id") != requester_id:
        raise ValueError("Only the admin can remove members.")

    if requester_id == target_user_id:
        raise ValueError("Admin cannot remove themselves.")

    result = family_members_collection.delete_one({
        "family_id": family_id,
        "user_id": target_user_id,
    })

    if result.deleted_count == 0:
        raise ValueError("Member not found in this family.")

    remaining = family_members_collection.count_documents({"family_id": family_id})

    if remaining == 0:
        families_collection.delete_one({"_id": ObjectId(family_id)})
        invite_codes_collection.delete_many({"family_id": family_id})
        return None

    return family


# ─── Rename family ────────────────────────────────────────────

def rename_family(family_id: str, user_id: str, new_name: str) -> dict:
    """Rename a family. Only admin can do this."""
    family = families_collection.find_one({"_id": ObjectId(family_id)})
    if not family:
        raise ValueError("Family not found.")
    if family.get("admin_user_id") != user_id:
        raise ValueError("Only the admin can rename the family.")
    families_collection.update_one(
        {"_id": ObjectId(family_id)},
        {"$set": {"name": new_name}},
    )
    family["name"] = new_name
    return family
