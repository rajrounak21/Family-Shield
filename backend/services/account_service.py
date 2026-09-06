"""Full account wipe: leaves/dissolves family, deletes private data,
anonymizes shared traces. Irreversible — caller must verify credentials."""

from bson import ObjectId

from core.database import (
    ai_conversations_collection,
    ai_shared_conversations_collection,
    ai_shared_messages_collection,
    email_verification_tokens_collection,
    fs,
    messages_collection,
    notifications_collection,
    password_reset_tokens_collection,
    push_subscriptions_collection,
    users_collection,
)
from services.context_service import delete_conversation
from services.family_service import get_user_family, leave_family

ANONYMOUS_NAME = "Deleted member"


def _delete_gridfs_file(file_id) -> None:
    if not file_id:
        return
    try:
        try:
            fs.delete(ObjectId(str(file_id)))
        except Exception:
            fs.delete(file_id)
    except Exception:
        pass


def delete_account(user_id: str) -> dict:
    """Wipe an account. Returns summary of what was removed."""
    summary = {
        "family_left": False,
        "family_dissolved": False,
        "admin_transferred_to": None,
        "ai_conversations_deleted": 0,
        "shares_deleted": 0,
        "chat_messages_scrubbed": 0,
        "images_deleted": 0,
        "notifications_deleted": 0,
    }

    # 1. Family exit (member → removed, admin → transfer, last-out → dissolve)
    family = get_user_family(user_id)
    if family:
        before_admin = family.get("admin_user_id")
        result = leave_family(str(family["_id"]), user_id)
        summary["family_left"] = True
        if result["dissolved"]:
            summary["family_dissolved"] = True
        elif before_admin == user_id:
            summary["admin_transferred_to"] = result.get("new_admin_id")

    # 2. AI data (conversations + messages + images + shares cascade inside)
    ai_convs = list(
        ai_conversations_collection.find({"user_id": user_id}, {"conversation_id": 1})
    )
    for conv in ai_convs:
        delete_conversation(conv["conversation_id"], user_id)
        summary["ai_conversations_deleted"] += 1

    # 3. Shares created by this user (any stragglers)
    strays = list(
        ai_shared_conversations_collection.find(
            {"shared_by": user_id}, {"share_id": 1}
        )
    )
    for share in strays:
        ai_shared_messages_collection.delete_many({"share_id": share["share_id"]})
        summary["shares_deleted"] += 1
    if strays:
        ai_shared_conversations_collection.delete_many({"shared_by": user_id})

    # 4. Family-chat footprint: scrub content + images, keep flow with alias
    own_msgs = list(
        messages_collection.find(
            {"sender_id": ObjectId(user_id)},
            {"image_id": 1},
        )
    )
    for m in own_msgs:
        _delete_gridfs_file(m.get("image_id"))
        summary["images_deleted"] += 1 if m.get("image_id") else 0

    res = messages_collection.update_many(
        {"sender_id": ObjectId(user_id)},
        {"$set": {
            "sender_name": ANONYMOUS_NAME,
            "content": "",
            "image_id": None,
        }},
    )
    summary["chat_messages_scrubbed"] = res.modified_count

    # Frozen reply-quote snapshots pointing back at this user
    messages_collection.update_many(
        {"reply_to.sender_id": user_id},
        {"$set": {"reply_to.sender_name": ANONYMOUS_NAME}},
    )

    # 5. Notifications + push subscriptions
    notif = notifications_collection.delete_many({"user_id": user_id})
    summary["notifications_deleted"] = notif.deleted_count
    push_subscriptions_collection.delete_many({"user_id": user_id})

    # 6. Auth residue + the user doc itself
    password_reset_tokens_collection.delete_many({"user_id": user_id})
    email_verification_tokens_collection.delete_many({"user_id": user_id})
    users_collection.delete_one({"_id": ObjectId(user_id)})

    # 7. Live sockets (best-effort; token is dead anyway)
    try:
        from routers.chat import manager

        for family_conns in list(manager.active_connections.values()):
            conn = family_conns.pop(user_id, None)
            if conn:
                try:
                    import anyio

                    anyio.from_thread.run(conn["ws"].close, 1000)
                except Exception:
                    pass
    except Exception:
        pass

    return summary
