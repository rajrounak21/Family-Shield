import secrets
import httpx
from urllib.parse import urlencode
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from utils.email import send_password_reset_email, send_verification_email
from core.config import settings
from core.database import users_collection, oauth_states_collection
from services.auth_service import get_or_create_google_user
from schemas.auth import (
    RegisterRequest,
    LoginRequest,
    UserResponse,
    TokenResponse,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    UpdateProfileRequest,
    ChangePasswordRequest,
    VerifyEmailRequest,
    DeleteAccountRequest,
)
from services.auth_service import (
    create_user,
    authenticate_user,
    generate_user_token,
    get_user_by_id,
    create_password_reset_token,
    reset_password,
    create_email_verification_code,
    verify_email_code,
)
from core.security import decode_access_token


router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)

security = HTTPBearer()


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(data: RegisterRequest):

    try:
        user = create_user(
            name=data.name,
            email=data.email,
            password=data.password,
        )

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return UserResponse(
        id=str(user["_id"]),
        name=user["name"],
        email=user["email"],
        auth_provider=user["auth_provider"],
        email_verified=user["email_verified"],
        onboarding_completed=user.get("onboarding_completed", False),
    )


@router.post(
    "/login",
    response_model=TokenResponse,
)
def login(data: LoginRequest):

    try:
        user = authenticate_user(
            email=data.email,
            password=data.password,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
        )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = generate_user_token(user)

    return TokenResponse(
        access_token=token,
        token_type="bearer",
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):

    token = credentials.credentials

    try:
        payload = decode_access_token(token)

    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    user = get_user_by_id(user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


@router.get(
    "/me",
    response_model=UserResponse,
)
def get_me(current_user=Depends(get_current_user)):

    return UserResponse(
        id=str(current_user["_id"]),
        name=current_user["name"],
        email=current_user["email"],
        auth_provider=current_user["auth_provider"],
        email_verified=current_user["email_verified"],
        onboarding_completed=current_user.get("onboarding_completed", False),
    )

@router.put("/onboarding")
def complete_onboarding(current_user=Depends(get_current_user)):
    users_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"onboarding_completed": True}},
    )
    return {"success": True}

@router.post("/forgot-password")
async def forgot_password(data: ForgotPasswordRequest):

    user = users_collection.find_one({
        "email": data.email.lower().strip()
    })

    if not user:
        return {
            "message": (
                "If an account exists with this email, "
                "a password reset link has been sent."
            )
        }

    token = create_password_reset_token(
        str(user["_id"])
    )

    reset_link = (
        f"{settings.frontend_url}/reset-password"
        f"?token={token}"
    )

    await send_password_reset_email(
        recipient_email=user["email"],
        reset_link=reset_link,
    )

    return {
        "message": (
            "If an account exists with this email, "
            "a password reset link has been sent."
        )
    }

@router.post("/reset-password")
def reset_password_endpoint(
    data: ResetPasswordRequest
):
    success = reset_password(
        token=data.token,
        new_password=data.new_password,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token",
        )

    return {
        "message": "Password reset successfully"
    }


@router.post("/send-verification")
async def send_verification(current_user=Depends(get_current_user)):
    """Email a fresh 6-digit verification code (60s cooldown)."""
    if current_user.get("email_verified"):
        return {"message": "Email is already verified."}
    user_id = str(current_user["_id"])
    try:
        code = create_email_verification_code(user_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(e),
        )
    try:
        await send_verification_email(
            recipient_email=current_user["email"],
            recipient_name=current_user.get("name", ""),
            code=code,
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send email. Please try again.",
        )
    return {"message": "Verification code sent."}


@router.post("/verify-email", response_model=UserResponse)
def verify_email(data: VerifyEmailRequest, current_user=Depends(get_current_user)):
    """Validate the 6-digit code and flip email_verified."""
    user_id = str(current_user["_id"])
    if not verify_email_code(user_id, data.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired code. Request a new one.",
        )
    user = get_user_by_id(user_id)
    return UserResponse(
        id=str(user["_id"]),
        name=user["name"],
        email=user["email"],
        auth_provider=user["auth_provider"],
        email_verified=user["email_verified"],
        onboarding_completed=user.get("onboarding_completed", False),
    )


@router.get("/oauth")
async def google_login(request: Request):
    state = secrets.token_urlsafe(32)
    oauth_states_collection.insert_one({
        "state": state,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
    })
    redirect_uri = f"{str(request.base_url).rstrip('/')}/auth/google/callback"
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return RedirectResponse(
        url="https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    )


@router.get("/google/callback")
async def google_callback(request: Request):
    state = request.query_params.get("state")
    code = request.query_params.get("code")

    if not state or not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing state or code parameter",
        )

    state_record = oauth_states_collection.find_one({"state": state})
    if not state_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OAuth state",
        )
    oauth_states_collection.delete_one({"state": state})

    redirect_uri = f"{str(request.base_url).rstrip('/')}/auth/google/callback"
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )

    if token_response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to exchange authorization code",
        )

    token_data = token_response.json()
    access_token = token_data.get("access_token")

    async with httpx.AsyncClient() as client:
        userinfo_response = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )

    if userinfo_response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to retrieve Google user information",
        )

    user_info = userinfo_response.json()
    google_id = user_info.get("sub")
    email = user_info.get("email")
    name = user_info.get("name")

    if not google_id or not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account information is incomplete",
        )

    user = get_or_create_google_user(
        google_id=google_id,
        email=email,
        name=name or email.split("@")[0],
    )

    app_token = generate_user_token(user)

    frontend_url = (
        f"{settings.frontend_url}"
        f"/auth/callback?token={app_token}"
    )

    return RedirectResponse(url=frontend_url)


# ─── Update profile ──────────────────────────────────────────

@router.put("/me", response_model=UserResponse)
def update_profile(
    data: UpdateProfileRequest,
    current_user=Depends(get_current_user),
):
    user_id = current_user["_id"]
    users_collection.update_one(
        {"_id": user_id},
        {"$set": {"name": data.name}},
    )
    updated = users_collection.find_one({"_id": user_id})
    return UserResponse(
        id=str(updated["_id"]),
        name=updated["name"],
        email=updated["email"],
        auth_provider=updated["auth_provider"],
        email_verified=updated["email_verified"],
        onboarding_completed=updated.get("onboarding_completed", False),
    )


# ─── Delete account (irreversible wipe) ───────────────────────

@router.delete("/me")
def delete_account_endpoint(
    data: DeleteAccountRequest,
    current_user=Depends(get_current_user),
):
    from core.security import verify_password
    from services.account_service import delete_account

    stored_hash = current_user.get("password_hash")
    if stored_hash:
        # Password account: must re-enter password.
        if not data.password or not verify_password(data.password, stored_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password is incorrect. Account was not deleted.",
            )
    else:
        # Google account: must type DELETE.
        if (data.confirm_text or "").strip() != "DELETE":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Type DELETE to confirm. Account was not deleted.',
            )

    summary = delete_account(str(current_user["_id"]))
    return {"detail": "Account deleted.", "summary": summary}


# ─── Change password ─────────────────────────────────────────

@router.put("/me/password")
def change_password(
    data: ChangePasswordRequest,
    current_user=Depends(get_current_user),
):
    from core.security import verify_password, hash_password

    stored_hash = current_user.get("password_hash")
    if not stored_hash or not verify_password(data.current_password, stored_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )

    users_collection.update_one(
        {"_id": current_user["_id"]},
        {"$set": {"password_hash": hash_password(data.new_password)}},
    )
    return {"success": True, "message": "Password updated successfully."}
