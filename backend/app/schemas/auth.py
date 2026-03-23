import uuid
from pydantic import BaseModel, Field, field_serializer, field_validator


class TokenResponse(BaseModel):
    """내부 전용 — make_tokens() 반환값. 클라이언트에 직접 노출하지 않는다."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AccessTokenResponse(BaseModel):
    """외부 API 응답용 — refresh_token은 HttpOnly 쿠키로 설정하므로 응답 body에 포함하지 않는다."""
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    avatar_url: str | None
    role: str
    oauth_provider: str | None
    is_onboarded: bool
    notification_email: str | None

    model_config = {"from_attributes": True}

    @field_serializer("id")
    def serialize_id(self, v: uuid.UUID) -> str:
        return str(v)


class OnboardRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    notification_email: str = Field(..., max_length=254)

    @field_validator("notification_email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip()
        if v and ("@" not in v or len(v) < 3):
            raise ValueError("Invalid email address")
        return v
