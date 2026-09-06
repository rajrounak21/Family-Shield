from bson import ObjectId
from core.database import (
    notifications_collection,
    push_subscriptions_collection,
    family_members_collection,
)
from models.notification import (
    create_notification_document,
    create_push_subscription_document,
)


def create_message_notifications(
    family_id: str,
    sender_id: str,
    sender_name: str,
    family_name: str,
    message_preview: str,
):
    """Create in-app notifications for all family members except the sender."""
    members = list(family_members_collection.find({
        "family_id": family_id,
        "status": {"$nin": ["removed", "blocked"]},
    }))

    for member in members:
        uid = member.get("user_id", "")
        if uid == sender_id:
            continue

        doc = create_notification_document(
            user_id=uid,
            family_id=family_id,
            family_name=family_name,
            sender_id=sender_id,
            sender_name=sender_name,
            notif_type="new_message",
            title=family_name,
            body=f"{sender_name}: {message_preview}",
        )
        notifications_collection.insert_one(doc)


def get_user_notifications(user_id: str, limit: int = 20, skip: int = 0):
    """Return paginated notifications for a user."""
    cursor = (
        notifications_collection
        .find({"user_id": user_id})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    return list(cursor)


def get_unread_count(user_id: str) -> int:
    return notifications_collection.count_documents({
        "user_id": user_id,
        "is_read": False,
    })


def mark_read(notification_id: str, user_id: str) -> bool:
    result = notifications_collection.update_one(
        {"_id": ObjectId(notification_id), "user_id": user_id},
        {"$set": {"is_read": True}},
    )
    return result.modified_count > 0


def mark_all_read(user_id: str) -> int:
    result = notifications_collection.update_many(
        {"user_id": user_id, "is_read": False},
        {"$set": {"is_read": True}},
    )
    return result.modified_count


def save_push_subscription(user_id: str, endpoint: str, keys: dict):
    """Upsert a push subscription for a user."""
    push_subscriptions_collection.update_one(
        {"user_id": user_id},
        {"$set": create_push_subscription_document(user_id, endpoint, keys)},
        upsert=True,
    )


def remove_push_subscription(endpoint: str):
    push_subscriptions_collection.delete_one({"endpoint": endpoint})


def get_subscriptions_for_family(family_id: str, exclude_user_id: str = None):
    """Get push subscriptions for all family members except exclude_user_id."""
    members = list(family_members_collection.find({
        "family_id": family_id,
        "status": {"$nin": ["removed", "blocked"]},
    }))
    user_ids = [m["user_id"] for m in members if m.get("user_id") != exclude_user_id]

    if not user_ids:
        return []

    return list(push_subscriptions_collection.find({"user_id": {"$in": user_ids}}))
