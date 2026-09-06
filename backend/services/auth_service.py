from bson import ObjectId
from pymongo.errors import DuplicateKeyError
from datetime import datetime, timedelta, timezone
from core.database import users_collection , password_reset_tokens_collection
from core.config import settings
from utils.token import generate_reset_token,hash_reset_token
from core.security import (
    hash_password,
    verify_password,
    create_access_token,
)
from models.user import create_user_document


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_user(name: str, email: str, password: str):

    email = email.lower().strip()

    existing_user = users_collection.find_one({
        "email": email
    })

    if existing_user:
        raise ValueError("Email is already registered")

    user_document = create_user_document(
        name=name,
        email=email,
        password_hash=hash_password(password),
    )

    try:
        result = users_collection.insert_one(user_document)
    except DuplicateKeyError:
        raise ValueError("Email is already registered")

    user_document["_id"] = result.inserted_id

    return user_document


def authenticate_user(email: str, password: str):

    email = email.lower().strip()

    user = users_collection.find_one({
        "email": email
    })

    if not user:
        raise ValueError("User does not exist, please sign up")

    stored_hash = user.get("password_hash")

    if not stored_hash:
        raise ValueError("Invalid email or password")

    if not verify_password(password, stored_hash):
        raise ValueError("Invalid email or password")

    return user


def get_or_create_google_user(
    google_id: str,
    email: str,
    name: str,
):
    email = email.lower().strip()

    # First try Google ID
    user = users_collection.find_one({
        "google_id": google_id
    })

    if user:
        return user

    # Then try email
    user = users_collection.find_one({
        "email": email
    })

    if user:
        # Existing email/password account.
        # Link Google authentication to it.
        users_collection.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "google_id": google_id,
                    "updated_at": utc_now(),
                }
            },
        )

        user["google_id"] = google_id

        return user

    # Create new Google user
    user_document = create_user_document(
        name=name,
        email=email,
        password_hash=None, # No password for Google users
        auth_provider="google",
        google_id=google_id,
    )
    user_document["email_verified"] = True

    try:
        result = users_collection.insert_one(user_document)
    except DuplicateKeyError:
        raise ValueError("Email is already registered")

    user_document["_id"] = result.inserted_id

    return user_document


def generate_user_token(user: dict) -> str:
    """Generate JWT access token for a user."""
    return create_access_token(
        user_id=str(user["_id"])
    )


def get_user_by_id(user_id: str):
    """Retrieve user by ObjectId string."""
    try:
        obj_id = ObjectId(user_id)
    except Exception:
        return None

    return users_collection.find_one({"_id": obj_id})


def create_password_reset_token(user_id: str) -> str:
    """Creates a token, hashes it, stores it, returns raw token."""
    raw_token = generate_reset_token()
    hashed_token = hash_reset_token(raw_token)
    
    expires_at = utc_now() + timedelta(
        minutes=settings.password_reset_expire_minutes
    )
    
    document = {
        "user_id": user_id,
        "token_hash": hashed_token,
        "expires_at": expires_at,
        "created_at": utc_now(),
    }
    
    password_reset_tokens_collection.insert_one(document)
    
    return raw_token

def reset_password(token: str, new_password: str) -> bool:
    """Validates token, updates password, deletes token."""
    
    hashed_token = hash_reset_token(token)
    
    token_doc = password_reset_tokens_collection.find_one({
        "token_hash": hashed_token,
        "expires_at": {"$gt": utc_now()}
    })
    
    if not token_doc:
        return False 
    
    user_id = token_doc["user_id"]
    new_password_hash = hash_password(new_password)
    
    users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {
            "$set": {
                "password_hash": new_password_hash,
                "updated_at": utc_now()
            }
        }
    )

    password_reset_tokens_collection.delete_many({
        "user_id": user_id
    })

    return True


# ─── Email verification (6-digit OTP) ─────────────────────────

VERIFICATION_CODE_TTL_MINUTES = 15
VERIFICATION_RESEND_COOLDOWN_SECONDS = 60


def create_email_verification_code(user_id: str) -> str:
    """Mint a 6-digit code (hashed at rest, 15-min TTL). Old codes die.
    Enforces a 60s resend cooldown. Returns the RAW code for emailing."""
    import secrets as _secrets
    from core.database import email_verification_tokens_collection

    latest = email_verification_tokens_collection.find_one(
        {"user_id": user_id},
        sort=[("created_at", -1)],
    )
    if latest and (utc_now() - latest["created_at"]).total_seconds() < VERIFICATION_RESEND_COOLDOWN_SECONDS:
        raise ValueError("Please wait a minute before requesting a new code.")

    email_verification_tokens_collection.delete_many({"user_id": user_id})

    raw_code = f"{_secrets.randbelow(900000) + 100000:06d}"
    email_verification_tokens_collection.insert_one({
        "user_id": user_id,
        "code_hash": hash_reset_token(raw_code),
        "expires_at": utc_now() + timedelta(minutes=VERIFICATION_CODE_TTL_MINUTES),
        "created_at": utc_now(),
        "used": False,
    })
    return raw_code


def verify_email_code(user_id: str, code: str) -> bool:
    """Validate code → flip email_verified. Single-use. Returns success."""
    from core.database import email_verification_tokens_collection

    doc = email_verification_tokens_collection.find_one({
        "user_id": user_id,
        "code_hash": hash_reset_token((code or "").strip()),
        "expires_at": {"$gt": utc_now()},
        "used": False,
    })
    if not doc:
        return False

    users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"email_verified": True, "updated_at": utc_now()}},
    )
    email_verification_tokens_collection.delete_many({"user_id": user_id})
    return True
