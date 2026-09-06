from fastapi import APIRouter, Depends, HTTPException, status

from routers.auth import get_current_user
from schemas.family import (
    CreateFamilyRequest,
    FamilyDetailResponse,
    FamilyResponse,
    InviteResponse,
    JoinFamilyRequest,
    MemberResponse,
    RenameFamilyRequest,
)
from services.family_service import (
    block_member,
    create_family,
    generate_invite,
    get_family_members,
    get_invite_url,
    get_user_family,
    join_family_by_code,
    leave_family,
    remove_member,
    rename_family,
    revoke_invite,
    unblock_member,
    validate_invite_code,
)


router = APIRouter(prefix="/family", tags=["Family"])


def _family_detail(family: dict, requester_id: str) -> FamilyDetailResponse:
    """Build a consistent detail response. Admins see inactive (removed/
    blocked) members with status; everyone else sees active members only.
    member_count is always active members."""
    family_id = str(family["_id"])
    is_admin = family.get("admin_user_id") == requester_id
    members = get_family_members(family_id, include_inactive=is_admin)
    active_count = sum(1 for m in members if m.get("status", "active") == "active")

    invite = None
    if is_admin:
        raw_invite = generate_invite(family_id=family_id, created_by=requester_id)
        invite = InviteResponse(
            invite_code=raw_invite["code"],
            invite_url=get_invite_url(raw_invite["code"]),
            expires_at=raw_invite["expires_at"],
            uses_count=len(raw_invite.get("uses") or []),
        )

    return FamilyDetailResponse(
        family=FamilyResponse(
            id=family_id,
            name=family["name"],
            admin_user_id=family["admin_user_id"],
            member_count=active_count,
        ),
        members=[MemberResponse(**m) for m in members],
        invite=invite,
    )


# ─── Create a family ───────────────────────────────────────────

@router.post("/create", response_model=FamilyDetailResponse, status_code=status.HTTP_201_CREATED)
def create_family_endpoint(
    data: CreateFamilyRequest,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])

    try:
        family = create_family(name=data.name, admin_user_id=user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    family_id = str(family["_id"])

    return _family_detail(family, user_id)


# ─── Get current user's family ────────────────────────────────

@router.get("/me", response_model=FamilyDetailResponse)
def get_my_family(current_user=Depends(get_current_user)):
    user_id = str(current_user["_id"])
    family = get_user_family(user_id)

    if not family:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not part of any family yet.",
        )

    family_id = str(family["_id"])

    return _family_detail(family, user_id)


# ─── Generate invite link ─────────────────────────────────────

@router.post("/invite", response_model=InviteResponse)
def get_invite(current_user=Depends(get_current_user), fresh: bool = False):
    user_id = str(current_user["_id"])
    family = get_user_family(user_id)

    if not family:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not part of any family.",
        )

    family_id = str(family["_id"])
    invite = generate_invite(family_id=family_id, created_by=user_id, fresh=fresh)

    return InviteResponse(
        invite_code=invite["code"],
        invite_url=get_invite_url(invite["code"]),
        expires_at=invite["expires_at"],
        uses_count=len(invite.get("uses") or []),
    )


# ─── Join via invite code ─────────────────────────────────────

@router.post("/join", response_model=FamilyDetailResponse)
def join_family(
    data: JoinFamilyRequest,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])

    try:
        family = join_family_by_code(invite_code=data.invite_code, user_id=user_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    family_id = str(family["_id"])
    members = get_family_members(family_id)

    return FamilyDetailResponse(
        family=FamilyResponse(
            id=family_id,
            name=family["name"],
            admin_user_id=family["admin_user_id"],
            member_count=len(members),
        ),
        members=[MemberResponse(**m) for m in members],
    )


# ─── Validate invite code (public, no auth needed) ───────────

@router.get("/join/{code}")
def check_invite(code: str):
    """Public endpoint — validates code and returns family name preview."""
    invite = validate_invite_code(code)
    from core.database import families_collection
    from bson import ObjectId
    family = families_collection.find_one({"_id": ObjectId(invite["family_id"])})
    if not family:
        raise HTTPException(status_code=404, detail="Family not found.")
    return {
        "valid": True,
        "family_name": family["name"],
        "invite_code": code,
        "expires_at": invite["expires_at"],
    }


# ─── Remove member (admin only) ──────────────────────────────

@router.delete("/members/{user_id}")
def remove_member_endpoint(
    user_id: str,
    current_user=Depends(get_current_user),
):
    requester_id = str(current_user["_id"])

    family = get_user_family(requester_id)
    if not family:
        raise HTTPException(status_code=404, detail="You are not part of any family.")

    family_id = str(family["_id"])

    try:
        result = remove_member(family_id, requester_id, user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if result is None:
        return {"dissolved": True, "detail": "Family dissolved. No members remaining."}

    return _family_detail(result, requester_id)


# ─── Block / unblock member (admin only) ─────────────────────

@router.post("/members/{user_id}/block", response_model=FamilyDetailResponse)
def block_member_endpoint(
    user_id: str,
    current_user=Depends(get_current_user),
):
    requester_id = str(current_user["_id"])
    family = get_user_family(requester_id)
    if not family:
        raise HTTPException(status_code=404, detail="You are not part of any family.")
    try:
        updated = block_member(str(family["_id"]), requester_id, user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _family_detail(updated, requester_id)


@router.post("/members/{user_id}/unblock", response_model=FamilyDetailResponse)
def unblock_member_endpoint(
    user_id: str,
    current_user=Depends(get_current_user),
):
    requester_id = str(current_user["_id"])
    family = get_user_family(requester_id)
    if not family:
        raise HTTPException(status_code=404, detail="You are not part of any family.")
    try:
        updated = unblock_member(str(family["_id"]), requester_id, user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _family_detail(updated, requester_id)


# ─── Leave family ────────────────────────────────────────────

@router.post("/leave")
def leave_family_endpoint(current_user=Depends(get_current_user)):
    user_id = str(current_user["_id"])
    family = get_user_family(user_id)
    if not family:
        raise HTTPException(status_code=404, detail="You are not part of any family.")
    try:
        result = leave_family(str(family["_id"]), user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if result["dissolved"]:
        return {"left": True, "dissolved": True, "detail": "You left. Family dissolved."}
    return {
        "left": True,
        "dissolved": False,
        "detail": "You left the family.",
        "new_admin_id": result["new_admin_id"],
    }


# ─── Revoke invite / force fresh invite (admin only) ─────────

@router.post("/invite/revoke")
def revoke_invite_endpoint(current_user=Depends(get_current_user)):
    user_id = str(current_user["_id"])
    family = get_user_family(user_id)
    if not family:
        raise HTTPException(status_code=404, detail="You are not part of any family.")
    try:
        revoke_invite(str(family["_id"]), user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"detail": "Invite link revoked."}


# ─── Rename family (admin only) ──────────────────────────────

@router.put("/family/rename")
def rename_family_endpoint(
    data: RenameFamilyRequest,
    current_user=Depends(get_current_user),
):
    requester_id = str(current_user["_id"])
    info = get_user_family(requester_id)
    if not info:
        raise HTTPException(status_code=400, detail="You are not in a family.")

    family_id = str(info["_id"])
    try:
        result = rename_family(family_id, requester_id, data.name)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))

    return {
        "success": True,
        "family": {
            "id": family_id,
            "name": result["name"],
        },
    }
