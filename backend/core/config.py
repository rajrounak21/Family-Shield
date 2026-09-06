from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]

class Settings(BaseSettings):
    mongodb_url: str = Field(validation_alias=AliasChoices("MONGODB_URI", "MONGODB_URL"))
    database_name: str = "FamilyShield"


    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    session_secret: str

    password_reset_expire_minutes: int = 15

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str
    smtp_password: str
    email_from: str | None = None
    google_client_id: str
    google_client_secret: str
    google_redirect_uri: str
    groq_api_key:str
    # Frontend
    frontend_url: str = "http://localhost:3000"

    # Web Push (VAPID)
    vapid_private_key: str = ""

    @field_validator("smtp_password")
    @classmethod
    def normalize_smtp_password(cls, value: str) -> str:
        return value.replace(" ", "")

    @field_validator("email_from")
    @classmethod
    def normalize_email_from(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
