import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import jwt
from core.security import decode_access_token
from schemas.case import (
    CaseCommentRequest,
    CaseDetailResponse,
    CaseMessageResponse,
    CaseResponse,
    CaseSummaryResponse,
    CreateCaseRequest,
    QuickResponseRequest,
    VerdictRequest,
)
from services.case_service import (
    add_comment,
    add_quick_response,
    create_case,
    get_case_detail,
    get_family_summary,
    get_my_cases,
    set_verdict,
)
from services.family_service import get_user_family

logger = logging.getLogger("familyshield.case")

router = APIRouter(prefix="/cases", tags=["cases"])
bearer_scheme = HTTPBearer()


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


def _case_error(e: Exception) -> HTTPException:
    if isinstance(e, PermissionError):
        return HTTPException(status_code=403, detail=str(e))
    msg = str(e).lower()
    if "not found" in msg:
        return HTTPException(status_code=404, detail=str(e))
    return HTTPException(status_code=400, detail=str(e))


@router.post("", response_model=CaseResponse)
async def create_new_case(req: CreateCaseRequest, user_id: str = Depends(get_current_user)):
    family = get_user_family(user_id)
    if not family:
        raise HTTPException(status_code=400, detail="You must be in a family.")
    try:
        case = create_case(
            user_id=user_id,
            family_id=str(family["_id"]),
            question=req.question,
            answer=req.answer,
            selected_ids=req.selected_ids,
            note=req.note,
        )
    except ValueError as e:
        raise _case_error(e)
    try:
        from routers.chat import manager

        await manager.broadcast(
            str(family["_id"]),
            {"type": "case_created", "case": case},
        )
    except Exception:
        pass
    logger.info("case_created user=%s case=%s", user_id, case["case_id"])
    return case


@router.get("", response_model=list[CaseResponse])
def list_my_cases(user_id: str = Depends(get_current_user)):
    return get_my_cases(user_id)


@router.get("/summary", response_model=CaseSummaryResponse)
def family_case_summary(
    family_id: str, user_id: str = Depends(get_current_user)
):
    try:
        return get_family_summary(family_id, user_id)
    except PermissionError as e:
        raise _case_error(e)


@router.get("/{case_id}", response_model=CaseDetailResponse)
def get_case(case_id: str, user_id: str = Depends(get_current_user)):
    try:
        return get_case_detail(case_id, user_id)
    except (ValueError, PermissionError) as e:
        raise _case_error(e)


@router.post("/{case_id}/messages", response_model=CaseMessageResponse)
async def post_case_comment(
    case_id: str, req: CaseCommentRequest, user_id: str = Depends(get_current_user)
):
    try:
        msg = add_comment(case_id, user_id, req.content)
    except (ValueError, PermissionError) as e:
        raise _case_error(e)
    try:
        from routers.chat import manager

        case = get_case_detail(case_id, user_id)
        await manager.broadcast(
            case["family_id"], {"type": "case_message", "message": msg}
        )
    except Exception:
        pass
    return msg


@router.post("/{case_id}/quick")
async def post_quick_response(
    case_id: str, req: QuickResponseRequest, user_id: str = Depends(get_current_user)
):
    try:
        result = add_quick_response(case_id, user_id, req.response)
    except (ValueError, PermissionError) as e:
        raise _case_error(e)
    try:
        from routers.chat import manager

        case = get_case_detail(case_id, user_id)
        await manager.broadcast(
            case["family_id"],
            {"type": "case_updated", "case_id": case_id, "status": case["status"]},
        )
    except Exception:
        pass
    return result


@router.post("/{case_id}/verdict", response_model=CaseResponse)
async def post_verdict(
    case_id: str, req: VerdictRequest, user_id: str = Depends(get_current_user)
):
    try:
        case = set_verdict(case_id, user_id, req.decision, req.note)
    except (ValueError, PermissionError) as e:
        raise _case_error(e)
    try:
        from routers.chat import manager

        await manager.broadcast(
            case["family_id"],
            {"type": "case_updated", "case_id": case_id, "status": case["status"]},
        )
    except Exception:
        pass
    logger.info("case_verdict user=%s case=%s", user_id, case_id)
    return case
