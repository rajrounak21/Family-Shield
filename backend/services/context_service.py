from datetime import datetime, timezone
from core.database import (
    ai_conversations_collection,
    ai_messages_collection,
)
from services.ai_service import chat_completion
import uuid


def create_conversation(user_id: str, title: str = "New Chat") -> dict:
    conversation_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "conversation_id": conversation_id,
        "user_id": user_id,
        "title": title,
        "summary": "",
        "summary_updated_at": None,
        "created_at": now,
        "updated_at": now,
    }
    ai_conversations_collection.insert_one(doc)
    return doc


def get_user_conversations(user_id: str, limit: int = 50) -> list[dict]:
    return list(
        ai_conversations_collection.find(
            {"user_id": user_id},
            {"_id": 0},
        )
        .sort("updated_at", -1)
        .limit(limit)
    )


def get_conversation(conversation_id: str) -> dict | None:
    return ai_conversations_collection.find_one(
        {"conversation_id": conversation_id}, {"_id": 0}
    )


def update_conversation_title(conversation_id: str, title: str):
    ai_conversations_collection.update_one(
        {"conversation_id": conversation_id},
        {"$set": {"title": title, "updated_at": datetime.now(timezone.utc)}},
    )


def touch_conversation(conversation_id: str):
    ai_conversations_collection.update_one(
        {"conversation_id": conversation_id},
        {"$set": {"updated_at": datetime.now(timezone.utc)}},
    )


def save_message(
    conversation_id: str,
    user_id: str,
    role: str,
    content: str,
    image_id: str | None = None,
    vision_result: str | None = None,
    metadata: dict | None = None,
) -> dict:
    message_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "message_id": message_id,
        "conversation_id": conversation_id,
        "user_id": user_id,
        "role": role,
        "content": content,
        "image_id": image_id,
        "vision_result": vision_result,
        "metadata": metadata,
        "created_at": now,
    }
    ai_messages_collection.insert_one(doc)
    touch_conversation(conversation_id)
    return doc


def get_recent_messages(conversation_id: str, limit: int = 10) -> list[dict]:
    return list(
        ai_messages_collection.find(
            {"conversation_id": conversation_id},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(limit)
    )


def get_conversation_messages(conversation_id: str) -> list[dict]:
    return list(
        ai_messages_collection.find(
            {"conversation_id": conversation_id},
            {"_id": 0},
        ).sort("created_at", 1)
    )


def _get_own_ai_message(conversation_id: str, user_id: str, message_id: str) -> dict:
    conv = get_conversation(conversation_id)
    if not conv or conv.get("user_id") != user_id:
        raise ValueError("Conversation not found.")
    msg = ai_messages_collection.find_one(
        {"conversation_id": conversation_id, "message_id": message_id},
        {"_id": 0},
    )
    if not msg:
        raise ValueError("Message not found.")
    return msg


def edit_user_message(
    conversation_id: str, user_id: str, message_id: str, content: str
) -> dict:
    """Edit own user message. Returns updated doc (caller re-runs pipeline)."""
    msg = _get_own_ai_message(conversation_id, user_id, message_id)
    if msg.get("role") != "user":
        raise ValueError("Only your own questions can be edited.")
    text = (content or "").strip()
    if not text:
        raise ValueError("Message text cannot be empty.")
    if len(text) > 8000:
        raise ValueError("Message is too long (max 8000 characters).")
    now = datetime.now(timezone.utc)
    ai_messages_collection.update_one(
        {"conversation_id": conversation_id, "message_id": message_id},
        {"$set": {"content": text, "is_edited": True, "updated_at": now}},
    )
    msg["content"] = text
    msg["is_edited"] = True
    msg["updated_at"] = now
    touch_conversation(conversation_id)
    return msg


def delete_assistant_reply_below(conversation_id: str, user_message_id: str) -> dict | None:
    """Delete the assistant message directly following a user message
    (pair delete). Returns the deleted doc, or None if absent."""
    msgs = get_conversation_messages(conversation_id)
    for i, m in enumerate(msgs):
        if m.get("message_id") == user_message_id and m.get("role") == "user":
            if i + 1 < len(msgs) and msgs[i + 1].get("role") == "assistant":
                target = msgs[i + 1]
                _delete_ai_message_doc(conversation_id, target["message_id"])
                return target
            return None
    return None


def _delete_ai_message_doc(conversation_id: str, message_id: str):
    from core.database import fs

    doc = ai_messages_collection.find_one(
        {"conversation_id": conversation_id, "message_id": message_id},
        {"image_id": 1},
    )
    if doc and doc.get("image_id"):
        try:
            from bson import ObjectId

            try:
                fs.delete(ObjectId(doc["image_id"]))
            except Exception:
                fs.delete(doc["image_id"])
        except Exception:
            pass
    ai_messages_collection.delete_one(
        {"conversation_id": conversation_id, "message_id": message_id}
    )
    touch_conversation(conversation_id)


def delete_ai_message(conversation_id: str, user_id: str, message_id: str) -> list[str]:
    """Hard-delete a message. User role also removes the assistant reply
    directly below it (pair delete). Returns deleted message_ids."""
    msg = _get_own_ai_message(conversation_id, user_id, message_id)
    deleted = [message_id]
    if msg.get("role") == "user":
        removed = delete_assistant_reply_below(conversation_id, message_id)
        if removed:
            deleted.append(removed["message_id"])
    _delete_ai_message_doc(conversation_id, message_id)
    return deleted


def set_message_feedback(
    conversation_id: str, user_id: str, message_id: str, value: str | None
) -> dict:
    """Set 👍/👎 feedback on an assistant message. None clears it."""
    msg = _get_own_ai_message(conversation_id, user_id, message_id)
    if msg.get("role") != "assistant":
        raise ValueError("Feedback is only available on AI answers.")
    if value not in ("up", "down", None):
        raise ValueError("Invalid feedback value.")
    ai_messages_collection.update_one(
        {"conversation_id": conversation_id, "message_id": message_id},
        {"$set": {"feedback": value}},
    )
    msg["feedback"] = value
    touch_conversation(conversation_id)
    return msg


def build_context(
    conversation_id: str,
    limit: int = 10,
    exclude_message_ids: set[str] | None = None,
    max_chars: int = 18000,
) -> list[dict]:
    """Level 1 (recent msgs) + Level 2 (rolling summary).

    Excludes just-saved messages so the caller can append the current
    input exactly once (avoids duplication).
    """
    conversation = get_conversation(conversation_id)
    recent = get_recent_messages(conversation_id, limit=limit)

    context = []

    if conversation and conversation.get("summary"):
        context.append({
            "role": "system",
            "content": f"Previous conversation summary: {conversation['summary']}",
        })

    excluded = exclude_message_ids or set()
    chars = 0
    kept: list[dict] = []
    # recent is newest-first: keep newest within budget, then restore order
    for msg in recent:
        if msg.get("message_id") in excluded:
            continue
        role = msg["role"]
        content = msg["content"]
        if msg.get("vision_result"):
            content = f"[Image was analyzed: {msg['vision_result']}]\n\n{content}"
        # Vision results can be long — cap per message
        if len(content) > 4000:
            content = content[:4000] + "..."
        if chars + len(content) > max_chars:
            break
        chars += len(content)
        kept.append({"role": role, "content": content})

    # kept is newest-first; restore chronological order
    context.extend(reversed(kept))
    return context


def generate_summary(conversation_id: str):
    """Rolling summary for long conversations. Never raises."""
    try:
        messages = get_conversation_messages(conversation_id)
        if len(messages) < 20:
            return

        conversation_text = "\n".join(
            f"{m['role']}: {(m.get('content') or '')[:200]}" for m in messages[-20:]
        )
        prompt = f"Summarize this conversation in 2-3 sentences:\n\n{conversation_text}"
        summary = chat_completion([{"role": "user", "content": prompt}])

        ai_conversations_collection.update_one(
            {"conversation_id": conversation_id},
            {
                "$set": {
                    "summary": (summary or "")[:2000],
                    "summary_updated_at": datetime.now(timezone.utc),
                }
            },
        )
    except Exception:
        pass


def delete_conversation(conversation_id: str, user_id: str):
    from core.database import fs
    from services.share_service import delete_shares_for_conversation

    # Collect AI-uploaded images before deleting messages
    try:
        from bson import ObjectId

        msgs = ai_messages_collection.find(
            {"conversation_id": conversation_id}, {"image_id": 1}
        )
        for m in msgs:
            image_id = m.get("image_id")
            if not image_id:
                continue
            try:
                try:
                    fs.delete(ObjectId(image_id))
                except Exception:
                    fs.delete(image_id)
            except Exception:
                pass
    except Exception:
        pass
    delete_shares_for_conversation(conversation_id)
    ai_messages_collection.delete_many({"conversation_id": conversation_id})
    ai_conversations_collection.delete_one(
        {"conversation_id": conversation_id, "user_id": user_id}
    )
