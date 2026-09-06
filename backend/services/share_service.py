import uuid
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError

from core.database import (
    ai_conversations_collection,
    ai_messages_collection,
    ai_shared_conversations_collection,
    ai_shared_messages_collection,
    family_members_collection,
    users_collection,
)


def generate_share_id() -> str:
    return "sh_" + uuid.uuid4().hex[:12]


def get_share_by_id(share_id: str) -> dict | None:
    return ai_shared_conversations_collection.find_one(
        {"share_id": share_id}, {"_id": 0}
    )


def get_share_by_conversation(conversation_id: str) -> dict | None:
    return ai_shared_conversations_collection.find_one(
        {"conversation_id": conversation_id, "status": "active"},
        {"_id": 0},
    )


def create_share(conversation_id: str, user_id: str, family_id: str) -> dict:
    existing = get_share_by_conversation(conversation_id)
    if existing and existing.get("status") == "active":
        return existing

    share_id = generate_share_id()
    now = datetime.now(timezone.utc)

    share_doc = {
        "share_id": share_id,
        "conversation_id": conversation_id,
        "family_id": family_id,
        "shared_by": user_id,
        "status": "active",
        "created_at": now,
        "revoked_at": None,
    }
    try:
        ai_shared_conversations_collection.insert_one(share_doc)
    except DuplicateKeyError:
        # Lost a concurrent share race — return the winner's share.
        winner = get_share_by_conversation(conversation_id)
        if winner:
            return winner
        raise

    messages = list(
        ai_messages_collection.find(
            {"conversation_id": conversation_id},
            {"_id": 0},
        ).sort("created_at", 1)
    )

    if messages:
        docs = []
        for msg in messages:
            docs.append({
                "share_id": share_id,
                "original_message_id": msg["message_id"],
                "role": msg["role"],
                "content": msg["content"],
                "image_id": msg.get("image_id"),
                "metadata": msg.get("metadata"),
                "created_at": msg["created_at"],
            })
        ai_shared_messages_collection.insert_many(docs)

    return share_doc


def get_shared_messages(share_id: str) -> list[dict]:
    return list(
        ai_shared_messages_collection.find(
            {"share_id": share_id}, {"_id": 0}
        ).sort("created_at", 1)
    )


def revoke_share(share_id: str, user_id: str) -> bool:
    share = get_share_by_id(share_id)
    if not share:
        return False
    if share.get("shared_by") != user_id:
        return False

    result = ai_shared_conversations_collection.update_one(
        {"share_id": share_id},
        {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc)}},
    )
    if result.modified_count > 0:
        # Drop the snapshot so revoked shares leave no orphaned messages.
        ai_shared_messages_collection.delete_many({"share_id": share_id})
        return True
    return False


def is_family_member(user_id: str, family_id: str) -> bool:
    membership = family_members_collection.find_one({
        "user_id": user_id,
        "family_id": family_id,
        "status": {"$nin": ["removed", "blocked"]},
    })
    return membership is not None


def get_user_family_id(user_id: str) -> str | None:
    membership = family_members_collection.find_one({
        "user_id": user_id,
        "status": {"$nin": ["removed", "blocked"]},
    })
    if membership:
        return membership.get("family_id")
    return None


def get_shared_with_me(user_id: str) -> list[dict]:
    family_id = get_user_family_id(user_id)
    if not family_id:
        return []

    shares = list(
        ai_shared_conversations_collection.find(
            {"family_id": family_id, "status": "active"},
            {"_id": 0},
        ).sort("created_at", -1)
    )

    result = []
    for s in shares:
        if s.get("shared_by") == user_id:
            continue
        sharer = users_collection.find_one(
            {"_id": __import__("bson").ObjectId(s["shared_by"])}
        )
        result.append({
            "share_id": s["share_id"],
            "conversation_id": s["conversation_id"],
            "shared_by": sharer.get("name", "Someone") if sharer else "Someone",
            "created_at": s["created_at"],
        })
    return result


def get_shared_by_name(user_id: str) -> str:
    user = users_collection.find_one({"_id": __import__("bson").ObjectId(user_id)})
    if user:
        return user.get("name", "Someone")
    return "Someone"


def delete_shares_for_conversation(conversation_id: str):
    shares = ai_shared_conversations_collection.find(
        {"conversation_id": conversation_id}
    )
    for share in shares:
        ai_shared_messages_collection.delete_many({"share_id": share["share_id"]})
    ai_shared_conversations_collection.delete_many(
        {"conversation_id": conversation_id}
    )
