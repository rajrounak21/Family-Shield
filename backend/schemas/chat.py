from datetime import datetime
from pydantic import BaseModel


class SendMessageRequest(BaseModel):
    content: str
    msg_type: str = "text"


class MessageReaction(BaseModel):
    emoji: str
    user_ids: list[str] = []
    count: int = 0


class ReplySnapshot(BaseModel):
    message_id: str
    sender_id: str = ""
    sender_name: str = "Unknown"
    content: str = ""


class MessageResponse(BaseModel):
    id: str
    family_id: str
    sender_id: str
    sender_name: str
    content: str
    type: str
    image_id: str | None = None
    created_at: str
    is_deleted: bool = False
    is_edited: bool = False
    updated_at: str | None = None
    reactions: list[MessageReaction] = []
    reply_to: ReplySnapshot | dict | None = None
    seen_by: list[str] = []


class ChatHistoryResponse(BaseModel):
    messages: list[MessageResponse]
    has_more: bool
    oldest_cursor: str | None


class UploadResponse(BaseModel):
    image_id: str
    message: str


class EditMessageRequest(BaseModel):
    content: str


class ReactionRequest(BaseModel):
    emoji: str


class SeenRequest(BaseModel):
    message_ids: list[str] = []
