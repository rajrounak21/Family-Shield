import secrets
from datetime import datetime, timezone, timedelta


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_family_document(name: str, admin_user_id: str) -> dict:
    now = utc_now()
    return {
        "name": name,
        "admin_user_id": admin_user_id,
        "created_at": now,
        "updated_at": now,
    }


def create_family_member_document(family_id: str, user_id: str) -> dict:
    return {
        "family_id": str(family_id),
        "user_id": str(user_id),
        "status": "active",
        "joined_at": utc_now(),
    }


def create_invite_document(family_id: str, created_by: str) -> dict:
    code = secrets.token_urlsafe(8)          # e.g. "xK2mN9pQ"
    expires_at = utc_now() + timedelta(days=7)
    return {
        "family_id": family_id,
        "created_by": created_by,
        "code": code,
        "status": "ACTIVE",
        "uses": [],
        "expires_at": expires_at,
        "created_at": utc_now(),
    }
