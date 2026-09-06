from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class CreateCaseRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    answer: dict = Field(default_factory=dict)
    selected_ids: list[str] = Field(default_factory=list)
    note: str = Field(default="", max_length=500)


class CaseCommentRequest(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class QuickResponseRequest(BaseModel):
    response: Literal["check", "dont", "safe"]


class VerdictRequest(BaseModel):
    decision: Literal["safe", "not_safe", "ignored", "reported"]
    note: str = Field(default="", max_length=500)


class CaseVerdict(BaseModel):
    decision: str
    by: str
    by_name: str = ""
    note: str = ""
    at: datetime | None = None


class CaseResponse(BaseModel):
    case_id: str
    family_id: str
    title: str
    created_by: str
    created_by_name: str = ""
    selected_ids: list[str] = []
    status: str = "waiting"
    verdict: CaseVerdict | dict | None = None
    ai_snapshot: dict = Field(default_factory=dict)
    note: str = ""
    created_at: datetime
    updated_at: datetime


class CaseMessageResponse(BaseModel):
    message_id: str
    sender_id: str
    sender_name: str = ""
    kind: str = "comment"
    content: str = ""
    response: str | None = None
    created_at: datetime


class CaseDetailResponse(CaseResponse):
    messages: list[CaseMessageResponse] = []
    selected_members: list[dict] = []


class CaseSummaryResponse(BaseModel):
    active: int = 0
    waiting: int = 0
    resolved: int = 0
