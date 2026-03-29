"""Add composite indexes on workflow_run_steps for N+1 prevention.

Revision ID: 0013
Revises: 0012
Create Date: 2026-03-29
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # (run_id, node_id) — 노드별 스텝 조회 (execute_workflow 루프 + resume 시)
    op.create_index(
        "ix_wrs_run_node",
        "workflow_run_steps",
        ["run_id", "node_id"],
        unique=False,
    )
    # (run_id, status) — done 스텝 집합 로딩 (resume 시 건너뜀 필터)
    op.create_index(
        "ix_wrs_run_status",
        "workflow_run_steps",
        ["run_id", "status"],
        unique=False,
    )
    # workflow_runs.status — 활성 실행 모니터링 쿼리
    op.create_index(
        "ix_workflow_runs_status",
        "workflow_runs",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_workflow_runs_status", table_name="workflow_runs")
    op.drop_index("ix_wrs_run_status", table_name="workflow_run_steps")
    op.drop_index("ix_wrs_run_node", table_name="workflow_run_steps")
