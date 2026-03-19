import uuid
from pydantic import BaseModel, field_serializer


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
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
    name: str
    notification_email: str


class RefreshRequest(BaseModel):
    refresh_token: str
