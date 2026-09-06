from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId

from routers.auth import get_current_user
from schemas.notification import (
    NotificationResponse,
    NotificationListResponse,
    PushSubscriptionRequest,
)
from services.notification_service import (
    get_user_notifications,
    get_unread_count,
    mark_read,
    mark_all_read,
    save_push_subscription,
    remove_push_subscription,
)
from services.family_service import get_user_family


router = APIRouter(prefix="/notifications", tags=["Notifications"])


def format_notification(doc: dict) -> NotificationResponse:
    return NotificationResponse(
        id=str(doc["_id"]),
        type=doc.get("type", "new_message"),
        title=doc.get("title", ""),
        body=doc.get("body", ""),
        family_id=doc.get("family_id", ""),
        sender_id=doc.get("sender_id", ""),
        is_read=doc.get("is_read", False),
        created_at=doc.get("created_at"),
        case_id=doc.get("case_id"),
        review_share_id=doc.get("review_share_id"),
    )


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    limit: int = 20,
    skip: int = 0,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    docs = get_user_notifications(user_id, limit, skip)
    unread = get_unread_count(user_id)
    return NotificationListResponse(
        notifications=[format_notification(d) for d in docs],
        unread_count=unread,
    )


@router.get("/unread")
def unread_count(current_user=Depends(get_current_user)):
    user_id = str(current_user["_id"])
    return {"unread_count": get_unread_count(user_id)}


@router.post("/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    updated = mark_read(notification_id, user_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"success": True}


@router.post("/read-all")
def mark_all_notifications_read(current_user=Depends(get_current_user)):
    user_id = str(current_user["_id"])
    count = mark_all_read(user_id)
    return {"marked_read": count}


@router.post("/subscribe")
def subscribe_push(
    data: PushSubscriptionRequest,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    save_push_subscription(user_id, data.endpoint, data.keys)
    return {"success": True}


@router.delete("/subscribe")
def unsubscribe_push(
    data: PushSubscriptionRequest,
    current_user=Depends(get_current_user),
):
    remove_push_subscription(data.endpoint)
    return {"success": True}
