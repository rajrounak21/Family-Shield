import base64
import json
import logging
import re
from groq import Groq
from core.config import settings

logger = logging.getLogger("familyshield.ai")

client = Groq(api_key=settings.groq_api_key)

# ─── Models (single place to change) ───
# Verified live against this Groq key. Do not change without re-testing
# via client.models.list() + a real call.
CHAT_MODEL = "openai/gpt-oss-120b"
VISION_MODEL = "qwen/qwen3.6-27b"
INTENT_MODEL = "openai/gpt-oss-120b"
SUMMARY_MODEL = "openai/gpt-oss-120b"

MAX_OUTPUT_TOKENS = 2048
MAX_CONTEXT_CHARS = 24000  # ~6k tokens guard before sending to Groq

VALID_INTENTS = {
    "SCAM_ANALYSIS",
    "MESSAGE_EXPLANATION",
    "DOCUMENT_ANALYSIS",
    "GENERAL_QUESTION",
}

SYSTEM_PROMPT = """You are FamilyShield AI, a digital safety assistant for families.

Your job: help users understand suspicious or confusing digital content (messages, screenshots, emails, links, documents).

CORE RULES:
1. Never claim something is "definitely a scam" — use "Potentially risky", "Suspicious indicators detected"
2. Distinguish between EVIDENCE FOUND and ASSUMPTIONS
3. Explain in simple language suitable for all ages
4. Always provide: risk level, indicators, explanation, recommended actions
5. If insufficient info: say "Unable to verify — recommend independent check"

OUTPUT FORMAT (respond in JSON):
{
    "risk_level": "high" | "medium" | "low" | "unable_to_assess",
    "indicators": ["list of suspicious signals found"],
    "explanation": ["clear reasons why each indicator is concerning"],
    "recommended_actions": ["safe next steps the user should take"],
    "summary": "one-line summary of the analysis"
}

LANGUAGE RULE (very important — match the user's language):
- Detect the user's language from their latest message and write ALL
  user-facing JSON values (indicators, explanation, recommended_actions,
  summary) in that SAME language and script.
- JSON keys and the risk_level value always stay in English.
- "hindi" = user wrote in Devanagari (e.g. क्या ये लिंक फेक है) → reply
  fully in Hindi, Devanagari script.
- "hinglish" = user wrote Hindi in Roman script (e.g. kya ye link fake
  hain) → reply in Hinglish, Roman script, casual like the user talks.
  Example summary: "Haan, risk high hain — ye link fake lag raha hai, ispar click mat karo."
- "english" = user wrote in English → reply in simple English.
- Never reply in English when the user wrote in Hindi/Hinglish. Never mix scripts.

Example — user: "kya ye link fake hain? http://sbi-reward-claim.xyz"
→ {"risk_level": "high", "indicators": ["link me bank ke naam ki galat spelling wali site hai", ...], "explanation": [...], "recommended_actions": ["link par click mat karo", ...], "summary": "Haan, risk high hain — ye link fake lag raha hai."}

IMPORTANT: Always respond with valid JSON matching this structure. No extra text outside the JSON."""


# ─── Response language detection ───
# The pipeline detects the user's language from their message and injects
# a matching instruction, so Hinglish/Hindi users get answers in their style.

HINGLISH_STRONG_MARKERS = {
    # Roman-script Hindi words that never appear in English sentences.
    "kya", "kyaa", "hai", "hain", "nahi", "nahin",
    "kaise", "kese", "batao", "bataiye", "bataye",
    "karo", "karoo", "karke", "yeh", "ye", "yah", "yaha",
    "meri", "mera", "mere", "aap", "aapka", "apka", "tum",
    "tumhara", "tumko", "mujhe", "mujhko", "kisko", "kisiko",
}

HINGLISH_HINDI_ROMAN = {
    # Roman Hindi words (need 2+ of these without any strong marker).
    "mat", "zara", "thoda", "thodi", "bahut", "bahot",
    "sahi", "galat", "paisa", "paise", "lag", "raha", "rahi", "rhe",
    "bhai", "bata", "dekho", "dekhu", "samjhao", "samajh",
}


def detect_response_language(content: str) -> str:
    """Return 'hindi' | 'hinglish' | 'english' for the user's message."""
    if not content:
        return "english"
    # Devanagari script → Hindi
    for ch in content:
        if "\u0900" <= ch <= "\u097F":
            return "hindi"
    words = set(re.findall(r"[a-zA-Z]+", content.lower()))
    if not words:
        return "english"
    if words & HINGLISH_STRONG_MARKERS:
        return "hinglish"
    if len(words & HINGLISH_HINDI_ROMAN) >= 2:
        return "hinglish"
    return "english"


def language_instruction_for(lang: str) -> str:
    if lang == "hindi":
        return (
            "The user wrote in Hindi (Devanagari). Write every user-facing "
            "JSON value (indicators, explanation, recommended_actions, summary) "
            "in Hindi using Devanagari script. Keep JSON keys and risk_level in English."
        )
    if lang == "hinglish":
        return (
            "The user wrote in Hinglish (Hindi in Roman script). Write every "
            "user-facing JSON value (indicators, explanation, recommended_actions, "
            "summary) in Hinglish, Roman script, casual like the user — e.g. "
            "'Haan, risk high hain', 'click mat karo'. Keep JSON keys and "
            "risk_level in English. Do NOT reply in formal English."
        )
    return (
        "The user wrote in English. Reply in simple English suitable for all ages."
    )


# ─── Emergency detection (SRS §25) ───
# If money was already transferred OR sensitive info already shared, the user
# needs official-channel guidance NOW — not just risk analysis. Keyword-based
# (no extra model call) so it works in English, Hindi and Hinglish.

EMERGENCY_MONEY_MARKERS = {
    # Hinglish / Roman Hindi
    "paise bhej", "paisa bhej", "payment kar di", "transfer kar di",
    "paise kat", "paisa kat", "kat gaya", "kat gaye", "debit ho",
    "paise de di", "paisa de di", "paise gaye", "paisa gaya",
    "paise chale gaye", "paisa chala gaya", "fraud ho gaya", "thagi",
    "thagi ho", "scammed", "loot liya", "chuna lag",
    # English
    "money sent", "already paid", "have paid", "transferred",
    "debited", "deducted", "amount debited", "sent the money",
    "made the payment", "lost money", "money gone", "money lost",
    "transaction", "utr", "reference no", "reference number",
    # Devanagari
    "पैसे भेज", "पैसा भेज", "भुगतान कर", "कट गए", "कट गया",
    "ट्रांसफर कर", "ठगी", "धोखाधड़ी", "पैसे चले गए", "पैसा चला गया",
}

EMERGENCY_INFO_MARKERS = {
    # Hinglish / Roman Hindi
    "otp de di", "otp bata di", "otp share", "otp de diya",
    "password de di", "password bata", "pin de di", "pin bata di",
    "cvv de di", "otp le liya", "account hack", "hack ho gaya",
    "kyc kar di", "screen share", "anydesk", "teamviewer",
    "remote access", "otp aa", "otp manga",
    # English
    "shared otp", "gave otp", "shared my otp", "shared password",
    "gave password", "shared pin", "account hacked", "got hacked",
    "shared my details", "gave my details",
    # Devanagari
    "ओटीपी दे", "ओटीपी बता", "पासवर्ड बता", "पासवर्ड दे",
    "हैक", "खाता हैक", "केवाईसी कर",
}


def detect_emergency(content: str) -> str | None:
    """Return 'money_lost' | 'info_shared' | None.

    Substring matching (multi-word phrases included), case-insensitive.
    Money takes priority when both match.
    """
    if not content:
        return None
    lowered = content.lower()
    if any(m in lowered for m in EMERGENCY_MONEY_MARKERS):
        return "money_lost"
    if any(m in lowered for m in EMERGENCY_INFO_MARKERS):
        return "info_shared"
    return None


def emergency_instruction_for(kind: str, lang: str) -> str:
    base = (
        "IMPORTANT — the user indicates money was already transferred "
        if kind == "money_lost" else
        "IMPORTANT — the user indicates sensitive information (OTP/password/PIN) "
        "was already shared with a stranger "
    )
    base += (
        "or their account may be compromised. This is an EMERGENCY situation. "
        "In addition to the normal analysis, make the FIRST recommended_action an "
        "urgent official-channel step: call India's cyber helpline 1930 immediately, "
        "report at cybercrime.gov.in, and contact their bank's official customer care "
        "to freeze/block the transaction. Never promise fund recovery. "
    )
    if lang == "hindi":
        return base + "Write this urgent guidance in Hindi (Devanagari script)."
    if lang == "hinglish":
        return base + "Write this urgent guidance in Hinglish (Roman script, casual)."
    return base


def chat_completion(
    messages: list[dict],
    model: str = CHAT_MODEL,
    temperature: float = 0.6,
) -> str:
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_completion_tokens=MAX_OUTPUT_TOKENS,
        top_p=0.95,
        stream=False,
    )
    return response.choices[0].message.content


def analyze_image(image_bytes: bytes, prompt: str | None = None) -> str:
    image_b64 = base64.b64encode(image_bytes).decode()

    if not prompt:
        prompt = (
            "Analyze this image. If it's a message, screenshot, email, or document, "
            "identify any suspicious elements, risk indicators, and explain what you see. "
            "Respond in JSON format with risk_level, indicators, explanation, recommended_actions, summary. "
            "Match the user's language for all user-facing text: if the user's message is in "
            "Hindi (Devanagari) reply in Hindi; if it is Hinglish (Roman script) reply in Hinglish "
            "(e.g. 'risk high hain'); otherwise reply in simple English. JSON keys stay in English."
        )

    response = client.chat.completions.create(
        model=VISION_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                    },
                ],
            }
        ],
        temperature=0.6,
        max_completion_tokens=1024,
        top_p=0.95,
        stream=False,
    )
    return response.choices[0].message.content


def detect_intent(content: str) -> str:
    """Classify request. Never raises — falls back to GENERAL_QUESTION."""
    try:
        prompt = f"""Classify this user request into exactly one category.
Reply with ONLY the category name, nothing else.
Note: the user may write in English, Hindi (Devanagari), or Hinglish (Roman script) — classify by meaning, not language.

Categories:
- SCAM_ANALYSIS: checking if something is a scam or phishing
- MESSAGE_EXPLANATION: understanding what a message means
- DOCUMENT_ANALYSIS: reviewing a document or email
- GENERAL_QUESTION: any other question about digital safety

User request: "{content[:2000]}"
"""

        result = chat_completion(
            [{"role": "user", "content": prompt}],
            model=INTENT_MODEL,
            temperature=0.3,
        )
        cleaned = _strip_thinking(result).upper()
        for intent in ("SCAM_ANALYSIS", "MESSAGE_EXPLANATION", "DOCUMENT_ANALYSIS", "GENERAL_QUESTION"):
            if intent in cleaned:
                return intent
        logger.warning("ai_intent_unrecognized raw=%r", result[:80])
    except Exception as e:
        logger.warning("ai_intent_failed error=%s", type(e).__name__)
    return "GENERAL_QUESTION"


def build_reasoning_messages(
    system_prompt: str,
    context: list[dict],
    current_content: str,
    vision_result: str | None = None,
) -> list[dict]:
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    if vision_result:
        messages.append({
            "role": "system",
            "content": f"Image analysis result: {vision_result}",
        })
    messages.extend(context)
    messages.append({"role": "user", "content": current_content})
    return trim_messages_to_budget(messages)


def trim_messages_to_budget(messages: list[dict]) -> list[dict]:
    """Keep system prompt + newest content; drop oldest context first."""
    if not messages:
        return messages
    system = [m for m in messages if m.get("role") == "system"]
    rest = [m for m in messages if m.get("role") != "system"]

    def size(msgs: list[dict]) -> int:
        total = 0
        for m in msgs:
            c = m.get("content", "")
            total += len(c) if isinstance(c, str) else len(str(c))
        return total

    # Drop oldest non-system messages until under budget
    while rest and size(system + rest) > MAX_CONTEXT_CHARS:
        rest.pop(0)
    return system + rest


def _strip_thinking(text: str) -> str:
    """Remove <think>...</think> reasoning traces (thinking models)."""
    if not text:
        return ""
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE)
    return cleaned.strip() or text


def parse_json_response(text: str) -> dict:
    cleaned = _strip_thinking(text)
    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", cleaned)
    if match:
        try:
            data = json.loads(match.group())
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    return {
        "risk_level": "unable_to_assess",
        "indicators": [],
        "explanation": [cleaned] if cleaned else ["No response generated."],
        "recommended_actions": ["Please try rephrasing your question."],
        "summary": "Unable to parse structured response.",
    }
