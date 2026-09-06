"""FamilyShield AI pipeline (LangGraph).

Flow:
    START -> input -> vision -> intent -> context -> reasoning -> validation -> presentation -> END

Vision is skipped internally when no image is attached.
All nodes are synchronous; the router runs the graph in a worker
thread (asyncio.to_thread) so the FastAPI event loop never blocks.

AI module is fully separate from family/chat — no family imports here.
"""

import logging
from typing import TypedDict

from langgraph.graph import StateGraph, START, END

from core.database import fs
from schemas.ai import AIAnalysisResult
from services.ai_service import (
    SYSTEM_PROMPT,
    CHAT_MODEL,
    analyze_image,
    build_reasoning_messages,
    chat_completion,
    detect_emergency,
    detect_intent,
    detect_response_language,
    emergency_instruction_for,
    language_instruction_for,
    parse_json_response,
)
from services.context_service import build_context

logger = logging.getLogger("familyshield.ai")


class AIState(TypedDict, total=False):
    user_id: str
    conversation_id: str
    content: str
    image_id: str | None
    user_message_id: str | None
    vision_result: str | None
    intent: str
    emergency: str | None
    response_language: str
    context: list
    raw_response: str | None
    structured: dict
    validated: bool
    model_used: str
    stages: list


def _stage(stages: list, key: str, label: str, status: str = "done") -> list:
    return stages + [{"key": key, "label": label, "status": status}]


# ─── Nodes ───

def input_node(state: AIState) -> dict:
    stages = list(state.get("stages") or [])
    content = (state.get("content") or "").strip()
    if not content and not state.get("image_id"):
        raise ValueError("Empty message: text or image required")
    stages = _stage(stages, "receive", "Input received")
    return {"content": content, "stages": stages}


def vision_node(state: AIState) -> dict:
    stages = list(state.get("stages") or [])
    image_id = state.get("image_id")
    if not image_id:
        stages = _stage(stages, "vision", "No image — text only", "skipped")
        return {"vision_result": None, "stages": stages}
    try:
        image_file = fs.get(image_id)
        image_bytes = image_file.read()
        if len(image_bytes) > 10 * 1024 * 1024:
            raise ValueError("Image exceeds 10MB")
        # Pass the user's message + language rule so image-only questions
        # asked in Hindi/Hinglish get answers in the same language.
        content = state.get("content") or ""
        lang = detect_response_language(content)
        prompt = (
            "Analyze this image. If it's a message, screenshot, email, or document, "
            "identify any suspicious elements, risk indicators, and explain what you see. "
            "Respond in JSON format with risk_level, indicators, explanation, recommended_actions, summary. "
            f"{language_instruction_for(lang)} "
            f"User message: {content[:2000]}"
        )
        result = analyze_image(image_bytes, prompt=prompt)
        stages = _stage(stages, "vision", "Image analyzed")
        return {"vision_result": result, "stages": stages}
    except Exception as e:
        logger.warning("ai_vision_failed error=%s", type(e).__name__)
        stages = _stage(stages, "vision", "Image analysis failed", "failed")
        return {"vision_result": None, "stages": stages}


def intent_node(state: AIState) -> dict:
    stages = list(state.get("stages") or [])
    intent = detect_intent(state.get("content") or "")
    emergency = detect_emergency(state.get("content") or "")
    if emergency:
        logger.info("ai_emergency_detected kind=%s", emergency)
        stages = _stage(stages, "emergency", "Urgent help needed")
    stages = _stage(stages, "intent", "Request identified")
    return {"intent": intent, "emergency": emergency, "stages": stages}


def context_node(state: AIState) -> dict:
    stages = list(state.get("stages") or [])
    excluded = {state["user_message_id"]} if state.get("user_message_id") else set()
    context = build_context(
        state["conversation_id"], limit=10, exclude_message_ids=excluded
    )
    stages = _stage(stages, "context", "Conversation context checked")
    return {"context": context, "stages": stages}


def reasoning_node(state: AIState) -> dict:
    stages = list(state.get("stages") or [])
    content = state.get("content") or ""
    lang = detect_response_language(content)
    system_prompt = SYSTEM_PROMPT + "\n\n" + language_instruction_for(lang)
    emergency = state.get("emergency")
    if emergency:
        system_prompt += "\n\n" + emergency_instruction_for(emergency, lang)
    logger.info("ai_response_language lang=%s", lang)
    messages = build_reasoning_messages(
        system_prompt,
        state.get("context") or [],
        content,
        state.get("vision_result"),
    )
    raw = chat_completion(messages, model=CHAT_MODEL)
    stages = _stage(stages, "reasoning", "Risk indicators analyzed")
    return {
        "raw_response": raw,
        "model_used": CHAT_MODEL,
        "response_language": lang,
        "emergency": emergency,
        "stages": stages,
    }


def validation_node(state: AIState) -> dict:
    stages = list(state.get("stages") or [])
    raw = state.get("raw_response") or ""
    parsed = parse_json_response(raw)

    # Single repair attempt when the model returned non-JSON prose
    if (
        parsed.get("risk_level") == "unable_to_assess"
        and not parsed.get("indicators")
        and raw.strip()
        and len(raw) < 6000
    ):
        try:
            repair = chat_completion([
                {
                    "role": "system",
                    "content": (
                        "Convert the following analysis into strict JSON with keys: "
                        "risk_level (high|medium|low|unable_to_assess), indicators (list), "
                        "explanation (list), recommended_actions (list), summary (string). "
                        "Reply with JSON only."
                    ),
                },
                {"role": "user", "content": raw[:4000]},
            ])
            reparsed = parse_json_response(repair)
            if reparsed.get("risk_level") != "unable_to_assess" or reparsed.get("indicators"):
                parsed = reparsed
                raw = repair
        except Exception as e:
            logger.warning("ai_repair_failed error=%s", type(e).__name__)

    try:
        validated = AIAnalysisResult(**{
            "risk_level": parsed.get("risk_level", "unable_to_assess"),
            "indicators": parsed.get("indicators", []) or [],
            "explanation": parsed.get("explanation", []) or [],
            "recommended_actions": parsed.get("recommended_actions", []) or [],
            "summary": parsed.get("summary", "") or "",
        })
        stages = _stage(stages, "validation", "Response reviewed")
        return {
            "structured": validated.model_dump(),
            "raw_response": raw,
            "validated": True,
            "stages": stages,
        }
    except Exception as e:
        logger.warning("ai_validation_failed error=%s", type(e).__name__)
        stages = _stage(stages, "validation", "Response review failed", "failed")
        return {
            "structured": {
                "risk_level": "unable_to_assess",
                "indicators": [],
                "explanation": [raw] if raw else ["No response generated."],
                "recommended_actions": ["Please try rephrasing your question."],
                "summary": "Validation failed.",
            },
            "validated": False,
            "stages": stages,
        }


def presentation_node(state: AIState) -> dict:
    stages = list(state.get("stages") or [])
    stages = _stage(stages, "presentation", "Answer ready")
    return {"stages": stages}


# ─── Graph ───

graph = StateGraph(AIState)
graph.add_node("input", input_node)
graph.add_node("vision", vision_node)
graph.add_node("intent", intent_node)
graph.add_node("context", context_node)
graph.add_node("reasoning", reasoning_node)
graph.add_node("validation", validation_node)
graph.add_node("presentation", presentation_node)

graph.add_edge(START, "input")
graph.add_edge("input", "vision")
graph.add_edge("vision", "intent")
graph.add_edge("intent", "context")
graph.add_edge("context", "reasoning")
graph.add_edge("reasoning", "validation")
graph.add_edge("validation", "presentation")
graph.add_edge("presentation", END)

ai_pipeline = graph.compile()


def run_pipeline(
    user_id: str,
    conversation_id: str,
    content: str,
    image_id: str | None = None,
    user_message_id: str | None = None,
) -> dict:
    """Run the full pipeline synchronously. Call from a worker thread."""
    return ai_pipeline.invoke({
        "user_id": user_id,
        "conversation_id": conversation_id,
        "content": content,
        "image_id": image_id,
        "user_message_id": user_message_id,
        "stages": [],
    })
