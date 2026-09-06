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


def _seen_ids(msg: dict) -> list[str]:
    seen = [str(u) for u in (msg.get("seen_by") or [])]
    if not seen and msg.get("sender_id"):
        # Legacy docs predate seen-tracking: sender counts as seen.
        seen = [str(msg["sender_id"])]
    return seen


def _reply_snapshot(family_id: str, reply_to_id: str) -> dict:
    """Build a frozen quote snapshot of the original message."""
    try:
        oid = ObjectId(reply_to_id)
    except Exception:
        raise ValueError("Original message not found.")
    orig = messages_collection.find_one({
        "_id": oid,
        "family_id": ObjectId(family_id),
    })
    if not orig:
        raise ValueError("Original message not found.")
    if orig.get("is_deleted"):
        raise ValueError("Cannot reply to a deleted message.")
    text = (orig.get("content") or "").strip()
    if (orig.get("type") or "text") == "image" and not text:
        text = "📷 Image"
    if len(text) > 140:
        text = text[:140] + "…"
    return {
        "message_id": str(orig["_id"]),
        "sender_id": str(orig.get("sender_id")),
        "sender_name": orig.get("sender_name", "Unknown"),
        "content": text,
    }


def send_message(family_id: str, sender_id: str, sender_name: str, content: str, msg_type: str = "text", image_id: str = None, reply_to: str = None) -> dict:
    reply_snapshot = None
    if reply_to:
        reply_snapshot = _reply_snapshot(family_id, reply_to)
    doc = {
        "family_id": ObjectId(family_id),
        "sender_id": ObjectId(sender_id),
        "sender_name": sender_name,
        "content": content,
        "type": msg_type,
        "image_id": ObjectId(image_id) if image_id else None,
        "reply_to": reply_snapshot,
        "seen_by": [ObjectId(sender_id)],
        "created_at": utc_now(),
    }
    result = messages_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return format_message(doc)


def mark_messages_seen(family_id: str, user_id: str, message_ids: list[str]) -> list[dict]:
    """Add user to seen_by on the given family messages. Returns the
    touched messages formatted (empty list for empty/unknown ids)."""
    oids = []
    for mid in (message_ids or [])[:100]:
        try:
            oids.append(ObjectId(mid))
        except Exception:
            continue
    if not oids:
        return []
    messages_collection.update_many(
        {
            "_id": {"$in": oids},
            "family_id": ObjectId(family_id),
        },
        {"$addToSet": {"seen_by": ObjectId(user_id)}},
    )
    touched = list(messages_collection.find({"_id": {"$in": oids}}))
    return [format_message(m) for m in touched]


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
        "is_deleted": {"$ne": True},
        "content": {"$regex": query, "$options": "i"},
    }).sort("created_at", -1).limit(limit)
    messages = list(cursor)
    messages.reverse()
    return [format_message(m) for m in messages]


def format_message(msg: dict) -> dict:
    reactions = []
    for r in (msg.get("reactions") or []):
        user_ids = [str(u) for u in (r.get("user_ids") or [])]
        if not user_ids:
            continue
        reactions.append({
            "emoji": r.get("emoji", ""),
            "user_ids": user_ids,
            "count": len(user_ids),
        })
    return {
        "id": str(msg["_id"]),
        "family_id": str(msg["family_id"]),
        "sender_id": str(msg["sender_id"]),
        "sender_name": msg.get("sender_name", "Unknown"),
        "content": msg.get("content", ""),
        "type": msg.get("type", "text"),
        "image_id": str(msg["image_id"]) if msg.get("image_id") else None,
        "created_at": msg["created_at"].isoformat() if msg.get("created_at") else "",
        "is_deleted": bool(msg.get("is_deleted", False)),
        "is_edited": bool(msg.get("is_edited", False)),
        "updated_at": msg["updated_at"].isoformat() if msg.get("updated_at") else None,
        "reactions": reactions,
        "reply_to": msg.get("reply_to"),
        "seen_by": _seen_ids(msg),
    }


ALLOWED_REACTION_EMOJIS = ["❤️", "😂", "😮", "😢", "🙏", "👍"]


def _get_own_message(family_id: str, message_id: str, user_id: str) -> dict:
    try:
        oid = ObjectId(message_id)
    except Exception:
        raise ValueError("Message not found.")
    msg = messages_collection.find_one({
        "_id": oid,
        "family_id": ObjectId(family_id),
    })
    if not msg:
        raise ValueError("Message not found.")
    if str(msg.get("sender_id")) != str(user_id):
        raise ValueError("You can only modify your own messages.")
    if msg.get("is_deleted"):
        raise ValueError("Message was deleted.")
    return msg


def edit_message(family_id: str, message_id: str, user_id: str, content: str) -> dict:
    """Edit own text message. Sets edited flag + timestamp."""
    msg = _get_own_message(family_id, message_id, user_id)
    if (msg.get("type") or "text") != "text":
        raise ValueError("Only text messages can be edited.")
    text = (content or "").strip()
    if not text:
        raise ValueError("Message text cannot be empty.")
    if len(text) > 4000:
        raise ValueError("Message is too long (max 4000 characters).")
    messages_collection.update_one(
        {"_id": msg["_id"]},
        {"$set": {
            "content": text,
            "is_edited": True,
            "updated_at": utc_now(),
        }},
    )
    msg["content"] = text
    msg["is_edited"] = True
    msg["updated_at"] = utc_now()
    return format_message(msg)


def delete_message(family_id: str, message_id: str, user_id: str) -> dict:
    """Tombstone own message for everyone. Content/image refs cleared."""
    msg = _get_own_message(family_id, message_id, user_id)
    messages_collection.update_one(
        {"_id": msg["_id"]},
        {"$set": {
            "is_deleted": True,
            "content": "",
            "image_id": None,
            "updated_at": utc_now(),
        }},
    )
    msg["is_deleted"] = True
    msg["content"] = ""
    msg["image_id"] = None
    msg["updated_at"] = utc_now()
    return format_message(msg)


def toggle_reaction(
    family_id: str, message_id: str, user_id: str, emoji: str
) -> dict:
    """Toggle one reaction emoji for a user. Anyone in the family can
    react to any non-deleted message."""
    if emoji not in ALLOWED_REACTION_EMOJIS:
        raise ValueError("Reaction not allowed.")
    try:
        oid = ObjectId(message_id)
    except Exception:
        raise ValueError("Message not found.")
    msg = messages_collection.find_one({
        "_id": oid,
        "family_id": ObjectId(family_id),
    })
    if not msg:
        raise ValueError("Message not found.")
    if msg.get("is_deleted"):
        raise ValueError("Cannot react to a deleted message.")

    reactions = list(msg.get("reactions") or [])
    entry = next((r for r in reactions if r.get("emoji") == emoji), None)
    if entry and str(user_id) in [str(u) for u in (entry.get("user_ids") or [])]:
        entry["user_ids"] = [
            u for u in (entry.get("user_ids") or []) if str(u) != str(user_id)
        ]
        reactions = [r for r in reactions if (r.get("user_ids") or [])]
    elif entry:
        entry["user_ids"] = list(entry.get("user_ids") or []) + [ObjectId(user_id)]
    else:
        reactions.append({"emoji": emoji, "user_ids": [ObjectId(user_id)]})

    messages_collection.update_one(
        {"_id": msg["_id"]},
        {"$set": {"reactions": reactions}},
    )
    msg["reactions"] = reactions
    return format_message(msg)


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
    members = family_members_collection.find(
        {"family_id": family_id, "status": {"$nin": ["removed", "blocked"]}}
    )
    member_list = []
    for member in members:
        user_id = member.get("user_id")
        if not user_id:
            continue
        user = users_collection.find_one({"_id": ObjectId(user_id)})
        if user:
            member_list.append({
                "user_id": str(user["_id"]),
                "name": user.get("name", "Unknown"),
            })
    return member_list


def is_family_member(family_id: str, user_id: str) -> bool:
    member = family_members_collection.find_one({
        "family_id": family_id,
        "user_id": user_id,
        "status": {"$nin": ["removed", "blocked"]},
    })
    return member is not None
