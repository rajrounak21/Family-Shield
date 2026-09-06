from datetime import datetime
from typing import List

from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: str
    type: str
    title: str
    body: str
    family_id: str
    sender_id: str
    is_read: bool
    created_at: datetime
    case_id: str | None = None
    review_share_id: str | None = None


class NotificationListResponse(BaseModel):
    notifications: List[NotificationResponse]
    unread_count: int


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    keys: dict
