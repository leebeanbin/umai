import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 비밀번호 (소셜 로그인만 사용 시 null)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # 소셜 로그인
    oauth_provider: Mapped[str | None] = mapped_column(
        Enum("google", "github", name="oauth_provider_enum"), nullable=True
    )
    oauth_sub: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    # 역할
    role: Mapped[str] = mapped_column(
        Enum("admin", "user", "pending", name="user_role_enum"),
        default="user",
        nullable=False,
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # 온보딩 완료 여부 (첫 소셜 로그인 후 닉네임/알림 이메일 설정)
    is_onboarded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 알림 수신 이메일 (온보딩 시 확인/변경 가능)
    notification_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
