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


# ─── Membership status helpers ──────────────────────────────────
# Legacy rows have no "status" field — they count as active.

def _active_only(query: dict) -> dict:
    """Add active-membership filter (matches 'active' + legacy rows)."""
    q = dict(query)
    q["status"] = {"$nin": ["removed", "blocked"]}
    return q


def _normalize_status(doc: dict) -> str:
    return doc.get("status") or "active"


def _is_active(doc: dict | None) -> bool:
    return bool(doc) and _normalize_status(doc) == "active"


# ─── Create family ────────────────────────────────────────────

def create_family(name: str, admin_user_id: str) -> dict:
    """Create a new family and add the creator as the first member."""

    existing = family_members_collection.find_one({"user_id": admin_user_id})
    if _is_active(existing):
        raise ValueError("You are already a member of a family.")

    family_doc = create_family_document(name=name, admin_user_id=admin_user_id)
    result = families_collection.insert_one(family_doc)
    family_id = str(result.inserted_id)

    if existing:
        # Reactivate a stale (removed/blocked) row — unique index allows
        # only one membership row per user.
        family_members_collection.update_one(
            {"user_id": admin_user_id},
            {"$set": {
                "family_id": family_id,
                "status": "active",
                "joined_at": utc_now(),
            }},
        )
    else:
        member_doc = create_family_member_document(
            family_id=family_id,
            user_id=admin_user_id,
        )
        family_members_collection.insert_one(member_doc)

    family_doc["_id"] = result.inserted_id
    return family_doc


# ─── Get user's family ─────────────────────────────────────────

def get_user_family(user_id: str) -> dict | None:
    """Return the family the user actively belongs to, or None."""
    membership = family_members_collection.find_one(
        _active_only({"user_id": user_id})
    )
    if not membership:
        return None
    family = families_collection.find_one({"_id": ObjectId(membership["family_id"])})
    return family


# ─── Get family members ────────────────────────────────────────

def get_family_members(family_id: str, include_inactive: bool = False) -> list[dict]:
    """Return enriched member list (user info + joined_at + status).

    Active-only by default; pass include_inactive=True for the admin view
    (shows removed/blocked chips).
    """
    query: dict = {"family_id": family_id}
    if not include_inactive:
        query = _active_only(query)
    memberships = list(family_members_collection.find(query))
    members = []
    for m in memberships:
        user_id = m.get("user_id")
        if not user_id:
            continue
        user = users_collection.find_one({"_id": ObjectId(user_id)})
        if user:
            members.append({
                "id": str(user["_id"]),
                "name": user["name"],
                "email": user["email"],
                "joined_at": m["joined_at"],
                "status": _normalize_status(m),
            })
    return members


# ─── Generate / retrieve invite ────────────────────────────────

def generate_invite(
    family_id: str, created_by: str, fresh: bool = False
) -> dict:
    """
    Return an existing non-expired, non-revoked invite for this family,
    or create a fresh one. Pass fresh=True to force-rotate the link.
    """
    now = utc_now()

    if not fresh:
        existing = invite_codes_collection.find_one({
            "family_id": family_id,
            "status": {"$ne": "REVOKED"},
            "expires_at": {"$gt": now},
        })

        if existing:
            return existing

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
    """Return invite doc if code is usable, raise 400 if not."""
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
    if (invite.get("status") or "ACTIVE") == "REVOKED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This invite link has been revoked. Ask the admin for a new one.",
        )
    return invite


def revoke_invite(family_id: str, requester_id: str) -> None:
    """Revoke all live invites for a family. Admin only."""
    family = families_collection.find_one({"_id": ObjectId(family_id)})
    if not family:
        raise ValueError("Family not found.")
    if family.get("admin_user_id") != requester_id:
        raise ValueError("Only the admin can revoke invites.")
    invite_codes_collection.update_many(
        {
            "family_id": family_id,
            "status": {"$ne": "REVOKED"},
            "expires_at": {"$gt": utc_now()},
        },
        {"$set": {"status": "REVOKED"}},
    )


# ─── Join family ───────────────────────────────────────────────

def join_family_by_code(invite_code: str, user_id: str) -> dict:
    """Add user to a family using an invite code.

    Blocked users are rejected; removed users rejoin by reactivating
    their row (never a duplicate insert — unique index on user_id).
    Every join is recorded on the invite's uses list.
    """

    existing_membership = family_members_collection.find_one({"user_id": user_id})
    if _is_active(existing_membership):
        raise ValueError("You are already a member of a family.")

    invite = validate_invite_code(invite_code)
    family_id = invite["family_id"]

    family = families_collection.find_one({"_id": ObjectId(family_id)})
    if not family:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Family no longer exists.",
        )

    if (
        existing_membership
        and _normalize_status(existing_membership) == "blocked"
        and existing_membership.get("family_id") == family_id
    ):
        raise ValueError("You have been blocked from this family.")

    invite_codes_collection.update_one(
        {"_id": invite["_id"]},
        {"$addToSet": {"uses": user_id}},
    )

    if existing_membership:
        family_members_collection.update_one(
            {"user_id": user_id},
            {"$set": {
                "family_id": family_id,
                "status": "active",
                "joined_at": utc_now(),
            }},
        )
    else:
        member_doc = create_family_member_document(
            family_id=family_id,
            user_id=user_id,
        )
        family_members_collection.insert_one(member_doc)
    return family


# ─── Remove member ─────────────────────────────────────────────

def remove_member(family_id: str, requester_id: str, target_user_id: str) -> dict | None:
    """Remove a member from family (status → removed, row kept for
    block/rejoin control). Returns updated family dict, or None if the
    family dissolved."""
    family = families_collection.find_one({"_id": ObjectId(family_id)})
    if not family:
        raise ValueError("Family not found.")

    if family.get("admin_user_id") != requester_id:
        raise ValueError("Only the admin can remove members.")

    if requester_id == target_user_id:
        raise ValueError("Admin cannot remove themselves.")

    result = family_members_collection.update_one(
        _active_only({
            "family_id": family_id,
            "user_id": target_user_id,
        }),
        {"$set": {"status": "removed"}},
    )

    if result.modified_count == 0:
        raise ValueError("Member not found in this family.")

    remaining = family_members_collection.count_documents(
        _active_only({"family_id": family_id})
    )

    if remaining == 0:
        families_collection.delete_one({"_id": ObjectId(family_id)})
        invite_codes_collection.delete_many({"family_id": family_id})
        return None

    return family


# ─── Block / unblock member ─────────────────────────────────────

def block_member(family_id: str, requester_id: str, target_user_id: str) -> dict:
    """Block a member. Blocked users cannot rejoin via any invite link."""
    family = families_collection.find_one({"_id": ObjectId(family_id)})
    if not family:
        raise ValueError("Family not found.")
    if family.get("admin_user_id") != requester_id:
        raise ValueError("Only the admin can block members.")
    if requester_id == target_user_id:
        raise ValueError("Admin cannot block themselves.")

    result = family_members_collection.update_one(
        {
            "family_id": family_id,
            "user_id": target_user_id,
        },
        {"$set": {"status": "blocked"}},
    )
    if result.matched_count == 0:
        raise ValueError("Member not found in this family.")
    return family


def unblock_member(family_id: str, requester_id: str, target_user_id: str) -> dict:
    """Unblock a member. They return to 'removed' — rejoin needs a fresh invite."""
    family = families_collection.find_one({"_id": ObjectId(family_id)})
    if not family:
        raise ValueError("Family not found.")
    if family.get("admin_user_id") != requester_id:
        raise ValueError("Only the admin can unblock members.")

    result = family_members_collection.update_one(
        {
            "family_id": family_id,
            "user_id": target_user_id,
            "status": "blocked",
        },
        {"$set": {"status": "removed"}},
    )
    if result.modified_count == 0:
        raise ValueError("Blocked member not found in this family.")
    return family


# ─── Leave family ─────────────────────────────────────────────

def leave_family(family_id: str, user_id: str) -> dict:
    """Leave a family. Normal members just leave; if the admin leaves with
    members remaining, adminship auto-transfers to the longest-tenured
    active member.

    Returns {"dissolved": bool, "family": dict|None, "new_admin_id": str|None}.
    """
    family = families_collection.find_one({"_id": ObjectId(family_id)})
    if not family:
        raise ValueError("Family not found.")

    own = family_members_collection.find_one(
        _active_only({"family_id": family_id, "user_id": user_id})
    )
    if not own:
        raise ValueError("You are not an active member of this family.")

    new_admin_id = None
    is_admin = family.get("admin_user_id") == user_id

    if is_admin:
        successor = family_members_collection.find_one(
            _active_only({
                "family_id": family_id,
                "user_id": {"$ne": user_id},
            }),
            sort=[("joined_at", 1)],
        )
        if successor:
            new_admin_id = successor["user_id"]
            families_collection.update_one(
                {"_id": ObjectId(family_id)},
                {"$set": {"admin_user_id": new_admin_id}},
            )

    family_members_collection.update_one(
        {"family_id": family_id, "user_id": user_id},
        {"$set": {"status": "removed"}},
    )

    remaining = family_members_collection.count_documents(
        _active_only({"family_id": family_id})
    )
    if remaining == 0:
        families_collection.delete_one({"_id": ObjectId(family_id)})
        invite_codes_collection.delete_many({"family_id": family_id})
        return {"dissolved": True, "family": None, "new_admin_id": None}

    updated = families_collection.find_one({"_id": ObjectId(family_id)})
    return {"dissolved": False, "family": updated, "new_admin_id": new_admin_id}


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
