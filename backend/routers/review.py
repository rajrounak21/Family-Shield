from typing import List

from fastapi import APIRouter, Depends, HTTPException
from bson import ObjectId

from routers.auth import get_current_user
from schemas.review import (
    ReviewShareRequest,
    ReviewShareResponse,
    ReviewListResponse,
    ReviewResponsesResponse,
    ReviewListItem,
    ReviewResponseItem,
    SubmitResponseRequest,
)
from services.review_service import (
    create_review_share,
    get_review_share,
    get_reviews_shared_with_me,
    get_reviews_i_shared,
    get_review_responses,
    submit_response,
    mark_seen,
)
from services.share_service import get_user_family_id, is_family_member
from core.database import users_collection


router = APIRouter(prefix="/review", tags=["review"])


@router.post("/share", response_model=ReviewShareResponse)
def share_for_review(
    data: ReviewShareRequest,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    family_id = get_user_family_id(user_id)
    if not family_id:
        raise HTTPException(status_code=400, detail="You must be in a family to share for review.")

    for mid in data.selected_ids:
        if not is_family_member(mid, family_id):
            raise HTTPException(status_code=400, detail=f"User {mid} is not in your family.")

    doc = create_review_share(
        conversation_id=data.conversation_id,
        user_id=user_id,
        family_id=family_id,
        question=data.question,
        answer=data.answer,
        selected_ids=data.selected_ids,
        note=data.note,
    )

    return ReviewShareResponse(
        share_id=doc["share_id"],
        question=doc["question"],
        note=doc.get("note", ""),
        created_at=doc["created_at"],
    )


@router.get("/shared-with-me")
def list_shared_with_me(current_user=Depends(get_current_user)):
    user_id = str(current_user["_id"])
    return get_reviews_shared_with_me(user_id)


@router.get("/i-shared")
def list_i_shared(current_user=Depends(get_current_user)):
    user_id = str(current_user["_id"])
    return get_reviews_i_shared(user_id)


@router.get("/{share_id}/detail")
def get_review_detail(
    share_id: str,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    share = get_review_share(share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Review not found.")

    is_sender = share["shared_by"] == user_id
    is_responder = user_id in share.get("selected_ids", [])
    if not is_sender and not is_responder:
        raise HTTPException(status_code=403, detail="You don't have access to this review.")

    sender = None
    try:
        sender = users_collection.find_one({"_id": ObjectId(share["shared_by"])})
    except Exception:
        pass

    return {
        "share_id": share["share_id"],
        "question": share["question"],
        "answer_content": share.get("answer_content", ""),
        "answer_metadata": share.get("answer_metadata"),
        "note": share.get("note", ""),
        "shared_by": sender.get("name", "Someone") if sender else "Someone",
        "shared_by_id": share["shared_by"],
        "created_at": share["created_at"],
        "selected_ids": share.get("selected_ids", []),
        "responded_ids": share.get("responded_ids", []),
        "is_sender": is_sender,
    }


@router.get("/{share_id}/responses", response_model=ReviewResponsesResponse)
def get_responses(
    share_id: str,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    share = get_review_share(share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Review not found.")

    is_sender = share["shared_by"] == user_id
    is_responder = user_id in share.get("selected_ids", [])
    if not is_sender and not is_responder:
        raise HTTPException(status_code=403, detail="You don't have access to this review.")

    responses = get_review_responses(share_id)
    return ReviewResponsesResponse(
        responses=[
            ReviewResponseItem(
                response_id=r["response_id"],
                responder_name=r["responder_name"],
                responder_initial=r["responder_initial"],
                response_text=r["response_text"],
                status=r["status"],
                created_at=r["created_at"],
                updated_at=r.get("updated_at"),
            )
            for r in responses
        ],
        responded_count=len(responses),
        selected_count=len(share.get("selected_ids", [])),
    )


@router.post("/{share_id}/respond")
def respond_to_review(
    share_id: str,
    data: SubmitResponseRequest,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    share = get_review_share(share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Review not found.")

    if user_id not in share.get("selected_ids", []):
        raise HTTPException(status_code=403, detail="You were not asked to review this.")

    if not data.response_text.strip():
        raise HTTPException(status_code=400, detail="Response cannot be empty.")

    result = submit_response(share_id, user_id, data.response_text.strip())
    if not result:
        raise HTTPException(status_code=404, detail="Review not found.")

    return result


@router.patch("/{share_id}/seen")
def mark_review_seen(
    share_id: str,
    current_user=Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    mark_seen(share_id, user_id)
    return {"success": True}
