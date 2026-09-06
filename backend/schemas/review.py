from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class ReviewShareRequest(BaseModel):
    conversation_id: str
    question: str
    answer: dict
    selected_ids: List[str]
    note: str = ""


class ReviewShareResponse(BaseModel):
    share_id: str
    question: str
    note: str
    created_at: datetime


class ReviewListItem(BaseModel):
    share_id: str
    question: str
    note: str
    created_at: datetime
    responded_count: int
    selected_count: int
    my_response: Optional[str] = None
    shared_by: Optional[str] = None
    shared_by_id: Optional[str] = None


class ReviewListResponse(BaseModel):
    shared_with_me: List[ReviewListItem]
    i_shared: List[ReviewListItem]


class ReviewResponseItem(BaseModel):
    response_id: str
    responder_name: str
    responder_initial: str
    response_text: str
    status: str
    created_at: datetime
    updated_at: Optional[datetime] = None


class ReviewResponsesResponse(BaseModel):
    responses: List[ReviewResponseItem]
    responded_count: int
    selected_count: int


class SubmitResponseRequest(BaseModel):
    response_text: str
