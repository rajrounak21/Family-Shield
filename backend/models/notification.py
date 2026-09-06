from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_notification_document(
    user_id: str,
    family_id: str,
    family_name: str,
    sender_id: str,
    sender_name: str,
    notif_type: str,
    title: str,
    body: str,
    case_id: str | None = None,
    review_share_id: str | None = None,
) -> dict:
    return {
        "user_id": user_id,
        "family_id": family_id,
        "family_name": family_name,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "type": notif_type,
        "title": title,
        "body": body,
        "case_id": case_id,
        "review_share_id": review_share_id,
        "is_read": False,
        "created_at": utc_now(),
    }


def create_push_subscription_document(user_id: str, endpoint: str, keys: dict) -> dict:
    return {
        "user_id": user_id,
        "endpoint": endpoint,
        "keys": keys,
        "created_at": utc_now(),
    }
