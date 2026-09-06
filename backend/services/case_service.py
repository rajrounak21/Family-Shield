"""Ask-Family case system: selected members, frozen AI evidence,
per-case thread, quick verdicts, creator-set final decision."""

import uuid
from datetime import datetime, timezone

from bson import ObjectId

from core.database import (
    case_messages_collection,
    cases_collection,
    families_collection,
    family_members_collection,
    users_collection,
)
from services.notification_service import create_notification_document
from core.database import notifications_collection


QUICK_RESPONSES = {
    "check": "I'll check",
    "dont": "Don't do it",
    "safe": "Looks safe",
}

TERMINAL_STATUSES = ["resolved", "ignored", "reported"]


def _push_to_selected(case: dict, target_ids: list[str], title: str, body: str):
    """Best-effort push to selected members' devices (deep link to case)."""
    try:
        from services.notification_service import get_subscriptions_for_family
        from services.push_service import send_push_notification

        subs = get_subscriptions_for_family(case["family_id"])
        online: set[str] = set()
        try:
            from routers.chat import manager

            if case["family_id"] in manager.active_connections:
                online = set(manager.active_connections[case["family_id"]].keys())
        except Exception:
            pass
        for sub in subs:
            uid = sub.get("user_id", "")
            if uid not in target_ids or uid in online:
                continue
            send_push_notification(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": sub.get("keys", {}),
                },
                title=title,
                body=body,
                url=f"/case/index.html?case_id={case['case_id']}",
            )
    except Exception:
        pass


def _now():
    return datetime.now(timezone.utc)


def _user_name(user_id: str) -> str:
    try:
        user = users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        user = None
    return (user.get("name") if user else None) or "Someone"


def _active_member_ids(family_id: str) -> set[str]:
    rows = family_members_collection.find(
        {
            "family_id": family_id,
            "status": {"$nin": ["removed", "blocked"]},
        },
        {"user_id": 1},
    )
    return {r.get("user_id") for r in rows if r.get("user_id")}


def _is_admin(family_id: str, user_id: str) -> bool:
    try:
        fam = families_collection.find_one({"_id": ObjectId(family_id)})
    except Exception:
        return False
    return bool(fam) and fam.get("admin_user_id") == user_id


def can_view_case(case: dict, user_id: str) -> bool:
    """Creator, selected members, or family admin can view/comment."""
    if case.get("created_by") == user_id:
        return True
    if user_id in (case.get("selected_ids") or []):
        return True
    return _is_admin(case.get("family_id", ""), user_id)


def _serialize_case(case: dict) -> dict:
    return {
        "case_id": case["case_id"],
        "family_id": case["family_id"],
        "title": case.get("title", ""),
        "created_by": case["created_by"],
        "created_by_name": case.get("created_by_name", "Someone"),
        "selected_ids": case.get("selected_ids", []),
        "status": case.get("status", "waiting"),
        "verdict": case.get("verdict"),
        "ai_snapshot": case.get("ai_snapshot", {}),
        "note": case.get("note", ""),
        "created_at": case["created_at"],
        "updated_at": case.get("updated_at", case["created_at"]),
    }


def create_case(
    user_id: str,
    family_id: str,
    question: str,
    answer: dict,
    selected_ids: list[str],
    note: str = "",
) -> dict:
    active = _active_member_ids(family_id)
    if user_id not in active:
        raise ValueError("You are not an active member of this family.")

    selected = [s for s in (selected_ids or []) if s in active and s != user_id]
    if not selected:
        raise ValueError("Select at least one family member to ask.")

    question = (question or "").strip()
    if not question:
        raise ValueError("Question cannot be empty.")

    snapshot = answer if isinstance(answer, dict) else {}
    structured = snapshot.get("structured") or snapshot.get("metadata", {}).get("structured") or {}

    # Prefer the human summary over raw model output (which may be JSON).
    raw_text = (snapshot.get("content") or "")
    answer_text = raw_text
    summary = (structured.get("summary") or "").strip()
    if summary:
        try:
            import json as _json

            parsed = _json.loads(raw_text) if raw_text.strip().startswith("{") else None
            if isinstance(parsed, dict):
                answer_text = summary
        except Exception:
            pass

    now = _now()
    doc = {
        "case_id": "cs_" + uuid.uuid4().hex[:12],
        "family_id": family_id,
        "title": (question[:50] + ("..." if len(question) > 50 else "")) or "Family case",
        "created_by": user_id,
        "created_by_name": _user_name(user_id),
        "selected_ids": selected,
        "status": "waiting",
        "verdict": None,
        "ai_snapshot": {
            "question": question,
            "answer": answer_text[:4000],
            "risk_level": structured.get("risk_level", "unable_to_assess"),
            "indicators": (structured.get("indicators") or [])[:8],
            "recommended_actions": (structured.get("recommended_actions") or [])[:8],
        },
        "note": (note or "")[:500],
        "created_at": now,
        "updated_at": now,
    }
    cases_collection.insert_one(doc)

    # Notify selected members only (in-app + push)
    try:
        fam = families_collection.find_one({"_id": ObjectId(family_id)})
        family_name = fam["name"] if fam else "Family"
    except Exception:
        family_name = "Family"
    for uid in selected:
        notifications_collection.insert_one(
            create_notification_document(
                user_id=uid,
                family_id=family_id,
                family_name=family_name,
                sender_id=user_id,
                sender_name=doc["created_by_name"],
                notif_type="case_assigned",
                title="Family needs your help",
                body=f"{doc['created_by_name']} asked about: {doc['title']}",
                case_id=doc["case_id"],
            )
        )
    _push_to_selected(
        {**doc, "family_id": family_id, "case_id": doc["case_id"]},
        selected,
        "Family needs your help",
        f"{doc['created_by_name']} asked about: {doc['title']}",
    )

    return _serialize_case(doc)


def get_my_cases(user_id: str) -> list[dict]:
    """Cases created by me or assigned to me, newest first."""
    membership = family_members_collection.find_one(
        {"user_id": user_id, "status": {"$nin": ["removed", "blocked"]}}
    )
    if not membership:
        return []
    rows = list(
        cases_collection.find(
            {
                "family_id": membership["family_id"],
                "$or": [{"created_by": user_id}, {"selected_ids": user_id}],
            }
        ).sort("updated_at", -1)
    )
    return [_serialize_case(c) for c in rows]


def get_case_detail(case_id: str, user_id: str) -> dict:
    case = cases_collection.find_one({"case_id": case_id}, {"_id": 0})
    if not case:
        raise ValueError("Case not found.")
    if not can_view_case(case, user_id):
        raise PermissionError("You don't have access to this case.")
    messages = list(
        case_messages_collection.find({"case_id": case_id}, {"_id": 0}).sort(
            "created_at", 1
        )
    )
    out = _serialize_case(case)
    out["messages"] = messages
    # Names for the reviews panel (selected members, incl. pending ones)
    named = []
    for uid in case.get("selected_ids") or []:
        named.append({"id": uid, "name": _user_name(uid)})
    out["selected_members"] = named
    return out


def _touch(case_id: str, status: str | None = None):
    update: dict = {"updated_at": _now()}
    if status:
        update["status"] = status
    cases_collection.update_one({"case_id": case_id}, {"$set": update})


def _maybe_activate(case: dict, actor_id: str):
    """First selected-member activity flips waiting → under_review."""
    if case.get("status") == "waiting" and actor_id in (
        case.get("selected_ids") or []
    ):
        _touch(case["case_id"], status="under_review")


def _notify_creator(case: dict, actor_id: str, actor_name: str, text: str):
    if case.get("created_by") == actor_id:
        return
    try:
        fam = families_collection.find_one({"_id": ObjectId(case["family_id"])})
        family_name = fam["name"] if fam else "Family"
    except Exception:
        family_name = "Family"
    notifications_collection.insert_one(
        create_notification_document(
            user_id=case["created_by"],
            family_id=case["family_id"],
            family_name=family_name,
            sender_id=actor_id,
            sender_name=actor_name,
            notif_type="case_response",
            title="New response on your case",
            body=f"{actor_name}: {text}",
            case_id=case["case_id"],
        )
    )


def add_comment(case_id: str, user_id: str, content: str) -> dict:
    case = cases_collection.find_one({"case_id": case_id}, {"_id": 0})
    if not case:
        raise ValueError("Case not found.")
    if not can_view_case(case, user_id):
        raise PermissionError("You don't have access to this case.")
    if case.get("status") in TERMINAL_STATUSES:
        raise ValueError("This case is closed.")
    text = (content or "").strip()
    if not text:
        raise ValueError("Message cannot be empty.")
    if len(text) > 2000:
        raise ValueError("Message is too long (max 2000 characters).")

    name = _user_name(user_id)
    doc = {
        "message_id": "cm_" + uuid.uuid4().hex[:12],
        "case_id": case_id,
        "sender_id": user_id,
        "sender_name": name,
        "kind": "comment",
        "content": text,
        "created_at": _now(),
    }
    case_messages_collection.insert_one(doc)
    _maybe_activate(case, user_id)
    _touch(case_id)
    _notify_creator(case, user_id, name, text[:80])
    return {k: v for k, v in doc.items() if k != "_id"}


def add_quick_response(case_id: str, user_id: str, response: str) -> dict:
    """One-tap verdict. Re-tap changes it (single doc per user)."""
    if response not in QUICK_RESPONSES:
        raise ValueError("Invalid response.")
    case = cases_collection.find_one({"case_id": case_id}, {"_id": 0})
    if not case:
        raise ValueError("Case not found.")
    if not can_view_case(case, user_id):
        raise PermissionError("You don't have access to this case.")
    if case.get("status") in TERMINAL_STATUSES:
        raise ValueError("This case is closed.")

    name = _user_name(user_id)
    case_messages_collection.update_one(
        {"case_id": case_id, "sender_id": user_id, "kind": "quick"},
        {
            "$set": {
                "response": response,
                "content": QUICK_RESPONSES[response],
                "sender_name": name,
                "created_at": _now(),
            },
            "$setOnInsert": {
                "message_id": "cm_" + uuid.uuid4().hex[:12],
                "case_id": case_id,
                "sender_id": user_id,
                "kind": "quick",
            },
        },
        upsert=True,
    )
    _maybe_activate(case, user_id)
    _touch(case_id)
    _notify_creator(case, user_id, name, QUICK_RESPONSES[response])
    return {"response": response, "label": QUICK_RESPONSES[response]}


def set_verdict(
    case_id: str, user_id: str, decision: str, note: str = ""
) -> dict:
    """Creator-only final decision. Locks the thread."""
    if decision not in ("safe", "not_safe", "ignored", "reported"):
        raise ValueError("Invalid decision.")
    case = cases_collection.find_one({"case_id": case_id}, {"_id": 0})
    if not case:
        raise ValueError("Case not found.")
    if case.get("created_by") != user_id:
        raise PermissionError("Only the person who asked can set the final decision.")
    if case.get("status") in TERMINAL_STATUSES:
        raise ValueError("This case is already closed.")

    status_map = {
        "safe": "resolved",
        "not_safe": "resolved",
        "ignored": "ignored",
        "reported": "reported",
    }
    verdict = {
        "decision": decision,
        "by": user_id,
        "by_name": _user_name(user_id),
        "note": (note or "")[:500],
        "at": _now(),
    }
    cases_collection.update_one(
        {"case_id": case_id},
        {"$set": {
            "verdict": verdict,
            "status": status_map[decision],
            "updated_at": _now(),
        }},
    )

    # Tell selected members the outcome
    try:
        fam = families_collection.find_one({"_id": ObjectId(case["family_id"])})
        family_name = fam["name"] if fam else "Family"
    except Exception:
        family_name = "Family"
    labels = {
        "safe": "Safe to proceed",
        "not_safe": "Do not proceed",
        "ignored": "Ignored",
        "reported": "Reported",
    }
    for uid in case.get("selected_ids") or []:
        if uid == user_id:
            continue
        notifications_collection.insert_one(
            create_notification_document(
                user_id=uid,
                family_id=case["family_id"],
                family_name=family_name,
                sender_id=user_id,
                sender_name=verdict["by_name"],
                notif_type="case_resolved",
                title="Case decided",
                body=f"{verdict['by_name']}: {labels[decision]} — {case.get('title', '')}",
                case_id=case["case_id"],
            )
        )
    _push_to_selected(
        case,
        [u for u in (case.get("selected_ids") or []) if u != user_id],
        "Case decided",
        f"{verdict['by_name']}: {labels[decision]} — {case.get('title', '')}",
    )

    case["verdict"] = verdict
    case["status"] = status_map[decision]
    return _serialize_case(case)


def get_family_summary(family_id: str, user_id: str) -> dict:
    """Active / waiting / resolved counters for the dashboard card."""
    membership = family_members_collection.find_one(
        {
            "user_id": user_id,
            "family_id": family_id,
            "status": {"$nin": ["removed", "blocked"]},
        }
    )
    if not membership:
        raise PermissionError("Not a member of this family.")
    base = {"family_id": family_id}
    active = cases_collection.count_documents(
        {**base, "status": {"$in": ["open", "waiting", "under_review"]}}
    )
    waiting = cases_collection.count_documents({**base, "status": "waiting"})
    resolved = cases_collection.count_documents(
        {**base, "status": {"$in": ["resolved", "ignored", "reported"]}}
    )
    return {"active": active, "waiting": waiting, "resolved": resolved}
