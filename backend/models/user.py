from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_user_document(
    name: str,
    email: str,
    password_hash: str | None,
    auth_provider: str = "email",
    google_id: str | None = None,
):

    now = utc_now()


    return {
        "name": name,
        "email": email.lower().strip(),
        "password_hash": password_hash,
        "auth_provider": auth_provider,
        "google_id": google_id,
        "email_verified": False,
        "onboarding_completed": False,
        "created_at": now,
        "updated_at": now,
    }
