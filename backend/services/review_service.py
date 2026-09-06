import uuid
from datetime import datetime, timezone

from bson import ObjectId
from core.database import (
    ai_review_shares_collection,
    ai_review_responses_collection,
    users_collection,
    family_members_collection,
    families_collection,
    notifications_collection,
)
from models.notification import create_notification_document


def _review_id() -> str:
    return "rv_" + uuid.uuid4().hex[:12]


def _resp_id() -> str:
    return "rr_" + uuid.uuid4().hex[:12]


def create_review_share(
    conversation_id: str,
    user_id: str,
    family_id: str,
    question: str,
    answer: dict,
    selected_ids: list[str],
    note: str = "",
) -> dict:
    share_id = _review_id()
    now = datetime.now(timezone.utc)

    doc = {
        "share_id": share_id,
        "conversation_id": conversation_id,
        "family_id": family_id,
        "shared_by": user_id,
        "question": question,
        "answer_content": answer.get("content", ""),
        "answer_metadata": answer.get("metadata"),
        "note": note,
        "selected_ids": selected_ids,
        "responded_ids": [],
        "status": "active",
        "created_at": now,
    }
    ai_review_shares_collection.insert_one(doc)

    sender = users_collection.find_one({"_id": ObjectId(user_id)})
    sender_name = sender.get("name", "Someone") if sender else "Someone"
    family = families_collection.find_one({"_id": ObjectId(family_id)}) if family_id else None
    family_name = family.get("name", "Family") if family else "Family"

    for mid in selected_ids:
        member = users_collection.find_one({"_id": ObjectId(mid)})
        member_name = member.get("name", "Someone") if member else "Someone"

        notif_doc = create_notification_document(
            user_id=mid,
            family_id=family_id,
            family_name=family_name,
            sender_id=user_id,
            sender_name=sender_name,
            notif_type="review_share",
            title="Review Request",
            body=f"{sender_name} asked for your review: {question[:80]}",
            review_share_id=share_id,
        )
        notifications_collection.insert_one(notif_doc)

    return doc


def get_review_share(share_id: str) -> dict | None:
    return ai_review_shares_collection.find_one(
        {"share_id": share_id}, {"_id": 0}
    )


def get_reviews_shared_with_me(user_id: str) -> list[dict]:
    cursor = ai_review_shares_collection.find(
        {"selected_ids": user_id, "status": "active"},
        {"_id": 0},
    ).sort("created_at", -1).limit(50)

    results = []
    for doc in cursor:
        sender = users_collection.find_one({"_id": ObjectId(doc["shared_by"])})
        sender_name = sender.get("name", "Someone") if sender else "Someone"
        my_resp = ai_review_responses_collection.find_one(
            {"share_id": doc["share_id"], "responder_id": user_id}
        )
        results.append({
            "share_id": doc["share_id"],
            "question": doc["question"],
            "shared_by": sender_name,
            "shared_by_id": doc["shared_by"],
            "note": doc.get("note", ""),
            "created_at": doc["created_at"],
            "responded_count": len(doc.get("responded_ids", [])),
            "selected_count": len(doc.get("selected_ids", [])),
            "my_response": my_resp.get("response_text") if my_resp else None,
        })
    return results


def get_reviews_i_shared(user_id: str) -> list[dict]:
    cursor = ai_review_shares_collection.find(
        {"shared_by": user_id, "status": "active"},
        {"_id": 0},
    ).sort("created_at", -1).limit(50)

    results = []
    for doc in cursor:
        results.append({
            "share_id": doc["share_id"],
            "question": doc["question"],
            "note": doc.get("note", ""),
            "created_at": doc["created_at"],
            "responded_count": len(doc.get("responded_ids", [])),
            "selected_count": len(doc.get("selected_ids", [])),
        })
    return results


def get_review_responses(share_id: str) -> list[dict]:
    cursor = ai_review_responses_collection.find(
        {"share_id": share_id},
        {"_id": 0},
    ).sort("created_at", 1)

    results = []
    for doc in cursor:
        user = users_collection.find_one({"_id": ObjectId(doc["responder_id"])})
        name = user.get("name", "Someone") if user else "Someone"
        initial = name[0].upper() if name else "?"
        results.append({
            "response_id": doc["response_id"],
            "responder_name": name,
            "responder_initial": initial,
            "response_text": doc["response_text"],
            "status": doc.get("status", "submitted"),
            "created_at": doc["created_at"],
            "updated_at": doc.get("updated_at"),
        })
    return results


def submit_response(share_id: str, user_id: str, response_text: str) -> dict:
    share = get_review_share(share_id)
    if not share:
        return None

    existing = ai_review_responses_collection.find_one(
        {"share_id": share_id, "responder_id": user_id}
    )
    now = datetime.now(timezone.utc)

    if existing:
        ai_review_responses_collection.update_one(
            {"_id": existing["_id"]},
            {"$set": {"response_text": response_text, "updated_at": now, "status": "updated"}},
        )
        return {
            "response_id": existing["response_id"],
            "status": "updated",
        }

    resp_id = _resp_id()
    doc = {
        "response_id": resp_id,
        "share_id": share_id,
        "responder_id": user_id,
        "response_text": response_text,
        "status": "submitted",
        "created_at": now,
        "updated_at": None,
    }
    ai_review_responses_collection.insert_one(doc)

    ai_review_shares_collection.update_one(
        {"share_id": share_id},
        {"$addToSet": {"responded_ids": user_id}},
    )

    sender = users_collection.find_one({"_id": ObjectId(user_id)})
    sender_name = sender.get("name", "Someone") if sender else "Someone"

    family = families_collection.find_one({"_id": ObjectId(share["family_id"])}) if share.get("family_id") else None
    family_name = family.get("name", "Family") if family else "Family"

    notif_doc = create_notification_document(
        user_id=share["shared_by"],
        family_id=share["family_id"],
        family_name=family_name,
        sender_id=user_id,
        sender_name=sender_name,
        notif_type="review_response",
        title="Review Response",
        body=f"{sender_name} responded to your review request",
        review_share_id=share_id,
    )
    notifications_collection.insert_one(notif_doc)

    return {
        "response_id": resp_id,
        "status": "submitted",
    }


def mark_seen(share_id: str, user_id: str) -> bool:
    result = ai_review_shares_collection.update_one(
        {"share_id": share_id, "selected_ids": user_id},
        {"$addToSet": {"seen_ids": user_id}},
    )
    return result.modified_count > 0 or result.matched_count > 0
