from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


RiskLevel = Literal["high", "medium", "low", "unable_to_assess"]

IntentType = Literal[
    "SCAM_ANALYSIS",
    "MESSAGE_EXPLANATION",
    "DOCUMENT_ANALYSIS",
    "GENERAL_QUESTION",
]


class NewConversationResponse(BaseModel):
    conversation_id: str
    title: str
    created_at: datetime


class SendMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    image_id: str | None = None


class AIAnalysisResult(BaseModel):
    risk_level: RiskLevel = "unable_to_assess"
    indicators: list[str] = Field(default_factory=list)
    explanation: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    summary: str = ""


class ProcessingStage(BaseModel):
    key: str
    label: str
    status: Literal["done", "skipped", "failed"] = "done"


class AIMetadata(BaseModel):
    intent: IntentType = "GENERAL_QUESTION"
    risk_level: RiskLevel = "unable_to_assess"
    structured: AIAnalysisResult | None = None
    processing_stages: list[ProcessingStage] = Field(default_factory=list)
    model_used: str = ""
    vision_used: bool = False
    response_language: str = "english"
    emergency: str | None = None


class MessageResponse(BaseModel):
    message_id: str
    role: str
    content: str
    image_id: str | None = None
    vision_result: str | None = None
    metadata: AIMetadata | dict | None = None
    created_at: datetime
    is_edited: bool = False
    feedback: str | None = None


class EditAIMessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class FeedbackRequest(BaseModel):
    value: str | None = None


class ConversationResponse(BaseModel):
    conversation_id: str
    title: str
    messages: list[MessageResponse]
    created_at: datetime


class ConversationListItem(BaseModel):
    conversation_id: str
    title: str
    updated_at: datetime


class ImageUploadResponse(BaseModel):
    image_id: str
    message: str = "Image uploaded successfully"
