from datetime import datetime, timezone
from bson import ObjectId
from core.database import (
    messages_collection,
    family_members_collection,
    users_collection,
    fs,
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def send_message(family_id: str, sender_id: str, sender_name: str, content: str, msg_type: str = "text", image_id: str = None) -> dict:
    doc = {
        "family_id": ObjectId(family_id),
        "sender_id": ObjectId(sender_id),
        "sender_name": sender_name,
        "content": content,
        "type": msg_type,
        "image_id": ObjectId(image_id) if image_id else None,
        "created_at": utc_now(),
    }
    result = messages_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return format_message(doc)


def get_chat_history(family_id: str, limit: int = 50, before: str = None) -> dict:
    query = {"family_id": ObjectId(family_id)}

    if before:
        query["created_at"] = {"$lt": ObjectId(before).generation_time}

    cursor = messages_collection.find(query).sort("created_at", -1).limit(limit + 1)
    messages = list(cursor)

    has_more = len(messages) > limit
    if has_more:
        messages = messages[:limit]

    messages.reverse()

    oldest_cursor = None
    if messages:
        oldest_cursor = str(messages[0]["_id"])

    return {
        "messages": [format_message(m) for m in messages],
        "has_more": has_more,
        "oldest_cursor": oldest_cursor,
    }


def search_messages(family_id: str, query: str, limit: int = 30) -> list[dict]:
    """Search messages by text content in a family."""
    cursor = messages_collection.find({
        "family_id": ObjectId(family_id),
        "content": {"$regex": query, "$options": "i"},
    }).sort("created_at", -1).limit(limit)
    messages = list(cursor)
    messages.reverse()
    return [format_message(m) for m in messages]


def format_message(msg: dict) -> dict:
    return {
        "id": str(msg["_id"]),
        "family_id": str(msg["family_id"]),
        "sender_id": str(msg["sender_id"]),
        "sender_name": msg.get("sender_name", "Unknown"),
        "content": msg.get("content", ""),
        "type": msg.get("type", "text"),
        "image_id": str(msg["image_id"]) if msg.get("image_id") else None,
        "created_at": msg["created_at"].isoformat() if msg.get("created_at") else "",
    }


def store_image(file_data: bytes, filename: str, content_type: str) -> str:
    file_id = fs.put(
        file_data,
        filename=filename,
        content_type=content_type,
    )
    return str(file_id)


def get_image(image_id: str):
    return fs.get(ObjectId(image_id))


def get_family_members(family_id: str) -> list:
    members = family_members_collection.find({"family_id": family_id})
    member_list = []
    for member in members:
        user_id = member.get("user_id")
        user = None
        if user_id:
            user = users_collection.find_one({"_id": user_id})
            if not user:
                try:
                    user = users_collection.find_one({"_id": ObjectId(user_id)})
                except Exception:
                    pass
        if user:
            member_list.append({
                "user_id": str(user["_id"]),
                "name": user.get("name", "Unknown"),
            })
    return member_list


def is_family_member(family_id: str, user_id: str) -> bool:
    # Try string match first (how family_members are stored)
    member = family_members_collection.find_one({
        "family_id": family_id,
        "user_id": user_id,
    })
    if member:
        return True

    # Try ObjectId conversions
    try:
        fam_oid = ObjectId(family_id)
        member = family_members_collection.find_one({
            "family_id": fam_oid,
            "user_id": user_id,
        })
        if member:
            return True
    except Exception:
        pass

    try:
        usr_oid = ObjectId(user_id)
        member = family_members_collection.find_one({
            "family_id": family_id,
            "user_id": usr_oid,
        })
        if member:
            return True
    except Exception:
        pass

    try:
        member = family_members_collection.find_one({
            "family_id": ObjectId(family_id),
            "user_id": ObjectId(user_id),
        })
        if member:
            return True
    except Exception:
        pass

    return False
