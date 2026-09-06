import asyncio
import logging
import time
from collections import defaultdict
from io import BytesIO

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import jwt
from core.database import fs
from core.security import decode_access_token
from schemas.ai import (
    AIMetadata,
    ConversationListItem,
    ConversationResponse,
    EditAIMessageRequest,
    FeedbackRequest,
    ImageUploadResponse,
    MessageResponse,
    NewConversationResponse,
    ProcessingStage,
    SendMessageRequest,
)
from services.context_service import (
    create_conversation,
    delete_assistant_reply_below,
    delete_ai_message,
    delete_conversation,
    edit_user_message,
    generate_summary,
    get_conversation,
    get_conversation_messages,
    save_message,
    set_message_feedback,
    get_user_conversations,
    update_conversation_title,
)
from services.ai_service import detect_response_language
from services.pipeline import run_pipeline

logger = logging.getLogger("familyshield.ai")

router = APIRouter(prefix="/ai", tags=["ai"])
bearer_scheme = HTTPBearer()

# ─── Rate limiting: 20 AI messages / minute / user ───
_RATE_LIMIT = 20
_RATE_WINDOW = 60.0
_rate_hits: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(user_id: str):
    now = time.monotonic()
    hits = [t for t in _rate_hits[user_id] if now - t < _RATE_WINDOW]
    _rate_hits[user_id] = hits
    if len(hits) >= _RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please wait a minute and try again.",
        )
    hits.append(now)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    try:
        payload = decode_access_token(credentials.credentials)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    return payload.get("sub", "")


def _require_conversation(conversation_id: str, user_id: str) -> dict:
    conv = get_conversation(conversation_id)
    if not conv or conv.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


def _to_message_response(m: dict) -> MessageResponse:
    return MessageResponse(
        message_id=m["message_id"],
        role=m["role"],
        content=m["content"],
        image_id=m.get("image_id"),
        vision_result=m.get("vision_result"),
        metadata=m.get("metadata"),
        created_at=m["created_at"],
        is_edited=bool(m.get("is_edited", False)),
        feedback=m.get("feedback"),
    )


def _mutation_error(e: ValueError) -> HTTPException:
    msg = str(e)
    if "not found" in msg.lower():
        return HTTPException(status_code=404, detail=msg)
    return HTTPException(status_code=400, detail=msg)


@router.post("/conversations", response_model=NewConversationResponse)
def new_conversation(user_id: str = Depends(get_current_user)):
    conv = create_conversation(user_id)
    return NewConversationResponse(
        conversation_id=conv["conversation_id"],
        title=conv["title"],
        created_at=conv["created_at"],
    )


@router.get("/conversations", response_model=list[ConversationListItem])
def list_conversations(user_id: str = Depends(get_current_user)):
    convs = get_user_conversations(user_id)
    return [
        ConversationListItem(
            conversation_id=c["conversation_id"],
            title=c["title"],
            updated_at=c["updated_at"],
        )
        for c in convs
    ]


@router.get("/conversations/{conversation_id}", response_model=ConversationResponse)
def get_conversation_detail(
    conversation_id: str, user_id: str = Depends(get_current_user)
):
    conv = _require_conversation(conversation_id, user_id)
    messages = get_conversation_messages(conversation_id)
    return ConversationResponse(
        conversation_id=conv["conversation_id"],
        title=conv["title"],
        messages=[_to_message_response(m) for m in messages],
        created_at=conv["created_at"],
    )


@router.post("/upload", response_model=ImageUploadResponse)
async def upload_ai_image(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):
    """Dedicated AI image upload (separate from family chat uploads)."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size must be less than 10MB")
    file_id = fs.put(
        data,
        filename=file.filename or "ai-upload",
        content_type=file.content_type,
    )
    logger.info("ai_image_uploaded user_id=%s", user_id)
    return ImageUploadResponse(image_id=str(file_id))


@router.get("/images/{image_id}")
def serve_ai_image(
    image_id: str,
    token: str | None = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(
        HTTPBearer(auto_error=False)
    ),
):
    """Serve AI-uploaded image. Accepts Bearer header OR ?token= query param
    (browsers can't send Authorization headers from <img> tags)."""
    raw = None
    if credentials:
        raw = credentials.credentials
    elif token:
        raw = token
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    try:
        decode_access_token(raw)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    try:
        try:
            grid_file = fs.get(ObjectId(image_id))
        except Exception:
            grid_file = fs.get(image_id)
        return StreamingResponse(
            BytesIO(grid_file.read()),
            media_type=getattr(grid_file, "content_type", None) or "image/png",
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Image not found")


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    req: SendMessageRequest,
    user_id: str = Depends(get_current_user),
):
    _check_rate_limit(user_id)
    conv = _require_conversation(conversation_id, user_id)

    content = (req.content or "").strip()
    if not content and not req.image_id:
        raise HTTPException(status_code=400, detail="Message text or image required")

    started = time.monotonic()

    # Save user message first so history survives AI failures
    user_msg = save_message(
        conversation_id=conversation_id,
        user_id=user_id,
        role="user",
        content=content or "Please analyze this image.",
        image_id=req.image_id,
    )

    if conv.get("title") == "New Chat":
        title = user_msg["content"][:50] + (
            "..." if len(user_msg["content"]) > 50 else ""
        )
        update_conversation_title(conversation_id, title or "New Chat")

    # Run LangGraph pipeline off the event loop (sync Groq + pymongo)
    try:
        result = await asyncio.to_thread(
            run_pipeline,
            user_id,
            conversation_id,
            user_msg["content"],
            req.image_id,
            user_msg["message_id"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(
            "ai_pipeline_failed conversation_id=%s error=%s",
            conversation_id,
            type(e).__name__,
        )
        _fallback_lang = detect_response_language(user_msg["content"])
        _fallback_text = {
            "hindi": "AI सेवा अभी उपलब्ध नहीं है। कृपया थोड़ी देर में फिर कोशिश करें।",
            "hinglish": "AI service abhi available nahi hai. Thodi der me phir try karo.",
        }.get(_fallback_lang, "AI service is temporarily unavailable. Please try again.")
        save_message(
            conversation_id=conversation_id,
            user_id=user_id,
            role="assistant",
            content=_fallback_text,
            metadata={
                "intent": "GENERAL_QUESTION",
                "risk_level": "unable_to_assess",
                "processing_stages": [
                    {"key": "receive", "label": "Input received", "status": "done"},
                    {"key": "reasoning", "label": "AI unavailable", "status": "failed"},
                ],
            },
        )
        raise HTTPException(
            status_code=503,
            detail="AI service is temporarily unavailable. Please try again.",
        )

    structured = result.get("structured") or {}
    stages = [
        ProcessingStage(
            key=s.get("key", ""),
            label=s.get("label", ""),
            status=s.get("status", "done"),
        )
        for s in (result.get("stages") or [])
    ]
    metadata = AIMetadata(
        intent=result.get("intent") or "GENERAL_QUESTION",
        risk_level=structured.get("risk_level", "unable_to_assess"),
        structured=structured,
        processing_stages=stages,
        model_used=result.get("model_used", ""),
        vision_used=bool(result.get("vision_result")),
        response_language=result.get("response_language", "english"),
        emergency=result.get("emergency"),
    )

    ai_msg = save_message(
        conversation_id=conversation_id,
        user_id=user_id,
        role="assistant",
        content=result.get("raw_response") or "No response generated.",
        metadata=metadata.model_dump(),
    )

    generate_summary(conversation_id)

    elapsed = round(time.monotonic() - started, 2)
    logger.info(
        "ai_message_done conversation_id=%s intent=%s risk=%s vision=%s latency_s=%s",
        conversation_id,
        metadata.intent,
        metadata.risk_level,
        metadata.vision_used,
        elapsed,
    )

    return {
        "assistant_message": _to_message_response(ai_msg),
        "user_message": _to_message_response(user_msg),
    }


@router.patch("/conversations/{conversation_id}/messages/{message_id}")
async def edit_conversation_message(
    conversation_id: str,
    message_id: str,
    req: EditAIMessageRequest,
    user_id: str = Depends(get_current_user),
):
    """Edit own question, drop the stale answer below it, and re-run
    the pipeline. Returns the edited + fresh assistant messages."""
    _check_rate_limit(user_id)
    _require_conversation(conversation_id, user_id)

    try:
        user_msg = edit_user_message(conversation_id, user_id, message_id, req.content)
    except ValueError as e:
        raise _mutation_error(e)

    delete_assistant_reply_below(conversation_id, message_id)

    try:
        result = await asyncio.to_thread(
            run_pipeline,
            user_id,
            conversation_id,
            user_msg["content"],
            user_msg.get("image_id"),
            user_msg["message_id"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(
            "ai_edit_rerun_failed conversation_id=%s error=%s",
            conversation_id,
            type(e).__name__,
        )
        _fallback_lang = detect_response_language(user_msg["content"])
        _fallback_text = {
            "hindi": "AI सेवा अभी उपलब्ध नहीं है। कृपया थोड़ी देर में फिर कोशिश करें।",
            "hinglish": "AI service abhi available nahi hai. Thodi der me phir try karo.",
        }.get(_fallback_lang, "AI service is temporarily unavailable. Please try again.")
        save_message(
            conversation_id=conversation_id,
            user_id=user_id,
            role="assistant",
            content=_fallback_text,
            metadata={
                "intent": "GENERAL_QUESTION",
                "risk_level": "unable_to_assess",
                "processing_stages": [
                    {"key": "receive", "label": "Input received", "status": "done"},
                    {"key": "reasoning", "label": "AI unavailable", "status": "failed"},
                ],
            },
        )
        raise HTTPException(
            status_code=503,
            detail="AI service is temporarily unavailable. Please try again.",
        )

    structured = result.get("structured") or {}
    stages = [
        ProcessingStage(
            key=s.get("key", ""),
            label=s.get("label", ""),
            status=s.get("status", "done"),
        )
        for s in (result.get("stages") or [])
    ]
    metadata = AIMetadata(
        intent=result.get("intent") or "GENERAL_QUESTION",
        risk_level=structured.get("risk_level", "unable_to_assess"),
        structured=structured,
        processing_stages=stages,
        model_used=result.get("model_used", ""),
        vision_used=bool(result.get("vision_result")),
        response_language=result.get("response_language", "english"),
        emergency=result.get("emergency"),
    )

    ai_msg = save_message(
        conversation_id=conversation_id,
        user_id=user_id,
        role="assistant",
        content=result.get("raw_response") or "No response generated.",
        metadata=metadata.model_dump(),
    )

    generate_summary(conversation_id)
    logger.info("ai_message_edited conversation_id=%s", conversation_id)

    return {
        "user_message": _to_message_response(user_msg),
        "assistant_message": _to_message_response(ai_msg),
    }


@router.delete("/conversations/{conversation_id}/messages/{message_id}")
def delete_conversation_message(
    conversation_id: str,
    message_id: str,
    user_id: str = Depends(get_current_user),
):
    """Hard-delete a message. A user question also removes the AI reply
    directly below it (pair delete)."""
    _require_conversation(conversation_id, user_id)
    try:
        deleted_ids = delete_ai_message(conversation_id, user_id, message_id)
    except ValueError as e:
        raise _mutation_error(e)
    logger.info(
        "ai_message_deleted conversation_id=%s deleted=%s",
        conversation_id,
        deleted_ids,
    )
    return {"deleted_ids": deleted_ids}


@router.post("/conversations/{conversation_id}/messages/{message_id}/feedback")
def feedback_conversation_message(
    conversation_id: str,
    message_id: str,
    req: FeedbackRequest,
    user_id: str = Depends(get_current_user),
):
    """👍/👎 feedback on an AI answer. null clears it."""
    _require_conversation(conversation_id, user_id)
    try:
        msg = set_message_feedback(conversation_id, user_id, message_id, req.value)
    except ValueError as e:
        raise _mutation_error(e)
    return _to_message_response(msg)


@router.delete("/conversations/{conversation_id}")
def remove_conversation(
    conversation_id: str, user_id: str = Depends(get_current_user)
):
    _require_conversation(conversation_id, user_id)
    delete_conversation(conversation_id, user_id)
    logger.info("ai_conversation_deleted conversation_id=%s", conversation_id)
    return {"detail": "Conversation deleted"}
