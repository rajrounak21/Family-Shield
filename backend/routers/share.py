import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import jwt
from core.config import settings
from core.security import decode_access_token
from schemas.ai import MessageResponse
from services.context_service import get_conversation
from services.share_service import (
    create_share,
    get_share_by_conversation,
    get_share_by_id,
    get_shared_messages,
    get_shared_by_name,
    get_shared_with_me,
    get_user_family_id,
    is_family_member,
    revoke_share,
)

logger = logging.getLogger("familyshield.share")

router = APIRouter(prefix="/ai", tags=["ai-share"])
bearer_scheme = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    try:
        payload = decode_access_token(credentials.credentials)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    return payload.get("sub", "")


@router.post("/conversations/{conversation_id}/share")
def share_conversation(
    conversation_id: str,
    user_id: str = Depends(get_current_user),
):
    conv = get_conversation(conversation_id)
    if not conv or conv.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")

    family_id = get_user_family_id(user_id)
    if not family_id:
        raise HTTPException(
            status_code=400,
            detail="You must be in a family to share conversations.",
        )

    existing = get_share_by_conversation(conversation_id)
    if existing and existing.get("status") == "active":
        return {
            "share_id": existing["share_id"],
            "link": f"{settings.frontend_url.rstrip('/')}/share/index.html?sid={existing['share_id']}",
            "already_shared": True,
        }

    share = create_share(conversation_id, user_id, family_id)
    link = f"{settings.frontend_url.rstrip('/')}/share/index.html?sid={share['share_id']}"

    logger.info("ai_conversation_shared user=%s conv=%s share=%s", user_id, conversation_id, share["share_id"])

    return {
        "share_id": share["share_id"],
        "link": link,
        "already_shared": False,
    }


@router.get("/conversations/{conversation_id}/share")
def get_share_status(
    conversation_id: str,
    user_id: str = Depends(get_current_user),
):
    conv = get_conversation(conversation_id)
    if not conv or conv.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")

    share = get_share_by_conversation(conversation_id)
    if not share:
        return {"shared": False}

    return {
        "shared": True,
        "share_id": share["share_id"],
        "link": f"{settings.frontend_url.rstrip('/')}/share/index.html?sid={share['share_id']}",
        "created_at": share["created_at"],
    }


@router.delete("/share/{share_id}")
def revoke_shared_conversation(
    share_id: str,
    user_id: str = Depends(get_current_user),
):
    success = revoke_share(share_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Share not found or not owned by you")

    logger.info("ai_share_revoked user=%s share=%s", user_id, share_id)
    return {"detail": "Sharing stopped"}


@router.get("/share/shared-with-me")
def list_shared_with_me(user_id: str = Depends(get_current_user)):
    return get_shared_with_me(user_id)


@router.get("/share/{share_id}")
def view_shared_conversation(share_id: str):
    share = get_share_by_id(share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Shared conversation not found")

    return {
        "share_id": share["share_id"],
        "status": share["status"],
        "family_id": share["family_id"],
        "shared_by": share["shared_by"],
        "created_at": share["created_at"],
        "title": "Shared Conversation",
    }


@router.get("/share/{share_id}/messages")
def view_shared_messages(
    share_id: str,
    user_id: str = Depends(get_current_user),
):
    share = get_share_by_id(share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Shared conversation not found")

    if share.get("status") != "active":
        raise HTTPException(status_code=410, detail="This shared conversation is no longer available.")

    if not is_family_member(user_id, share["family_id"]):
        raise HTTPException(
            status_code=403,
            detail="You are not a member of the family this conversation was shared with.",
        )

    messages = get_shared_messages(share_id)
    shared_by_name = get_shared_by_name(share["shared_by"])

    return {
        "share_id": share_id,
        "shared_by": shared_by_name,
        "shared_by_id": share["shared_by"],
        "created_at": share["created_at"],
        "messages": [
            MessageResponse(
                message_id=m["original_message_id"],
                role=m["role"],
                content=m["content"],
                image_id=m.get("image_id"),
                metadata=m.get("metadata"),
                created_at=m["created_at"],
            )
            for m in messages
        ],
    }
