from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class CreateFamilyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class JoinFamilyRequest(BaseModel):
    invite_code: str


class FamilyResponse(BaseModel):
    id: str
    name: str
    admin_user_id: str
    member_count: int


class MemberResponse(BaseModel):
    id: str
    name: str
    email: str
    joined_at: datetime
    status: str = "active"


class InviteResponse(BaseModel):
    invite_code: str
    invite_url: str
    expires_at: datetime
    uses_count: int = 0


class FamilyDetailResponse(BaseModel):
    family: FamilyResponse
    members: List[MemberResponse]
    invite: Optional[InviteResponse] = None


class RenameFamilyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
