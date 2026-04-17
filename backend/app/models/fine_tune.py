import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TrainingDataset(Base):
    """파인튜닝용 학습 데이터셋."""

    __tablename__ = "training_datasets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    # "chat" | "instruction" | "completion"
    format: Mapped[str] = mapped_column(String(20), nullable=False, default="chat")
    # 실제 학습 예제 목록 (JSONL 파싱 결과)
    examples: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    example_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class FineTuneJob(Base):
    """오픈 모델 파인튜닝 작업."""

    __tablename__ = "fine_tune_jobs"
    __table_args__ = (
        Index("ix_fine_tune_jobs_owner_status", "owner_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    dataset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("training_datasets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 베이스 모델 HuggingFace ID (예: "meta-llama/Llama-3.1-8B-Instruct")
    base_model: Mapped[str] = mapped_column(String(200), nullable=False)
    # "lora" | "qlora" | "full"
    method: Mapped[str] = mapped_column(String(20), nullable=False, default="lora")
    # 학습 하이퍼파라미터
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # "pending" | "running" | "done" | "failed" | "cancelled"
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_steps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 학습 지표: {steps: [int], train_loss: [float], val_loss: [float], learning_rate: [float]}
    metrics: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=lambda: {
            "steps": [],
            "train_loss": [],
            "val_loss": [],
            "learning_rate": [],
        },
    )
    # Ollama 등에 등록할 출력 모델명
    output_model_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    logs: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
