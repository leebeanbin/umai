"""Reconcile users table with current User model.

0001 created users with provider/provider_id columns.
The User model was refactored to use oauth_provider/oauth_sub/role/is_onboarded.
This migration bridges the gap.

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. Create enum types (idempotent) ─────────────────────────────────────
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE user_role_enum AS ENUM ('admin', 'user', 'pending'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$"
    ))
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE oauth_provider_enum AS ENUM ('google', 'github'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; "
        "END $$"
    ))

    # ── 2. Add new columns (skip if already exist) ────────────────────────────
    existing = {
        row[0] for row in conn.execute(sa.text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'users'"
        ))
    }

    if "role" not in existing:
        op.add_column("users", sa.Column(
            "role",
            sa.Enum("admin", "user", "pending", name="user_role_enum"),
            nullable=False,
            server_default="user",
        ))

    if "oauth_provider" not in existing:
        op.add_column("users", sa.Column(
            "oauth_provider",
            sa.Enum("google", "github", name="oauth_provider_enum"),
            nullable=True,
        ))

    if "oauth_sub" not in existing:
        op.add_column("users", sa.Column(
            "oauth_sub",
            sa.String(255),
            nullable=True,
        ))
        op.create_index("ix_users_oauth_sub", "users", ["oauth_sub"])

    if "is_onboarded" not in existing:
        op.add_column("users", sa.Column(
            "is_onboarded",
            sa.Boolean,
            nullable=False,
            server_default="false",
        ))

    if "notification_email" not in existing:
        op.add_column("users", sa.Column(
            "notification_email",
            sa.String(255),
            nullable=True,
        ))

    if "last_seen_at" not in existing:
        op.add_column("users", sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ))

    # ── 3. Migrate legacy provider column → oauth_provider/oauth_sub ──────────
    # If old column "provider" exists, copy data then drop it.
    if "provider" in existing:
        # Copy: provider='google'|'github' → oauth_provider
        conn.execute(sa.text(
            "UPDATE users SET oauth_provider = provider::oauth_provider_enum "
            "WHERE provider IN ('google', 'github') AND oauth_provider IS NULL"
        ))
        op.drop_column("users", "provider")

    if "provider_id" in existing:
        # Copy: provider_id → oauth_sub
        conn.execute(sa.text(
            "UPDATE users SET oauth_sub = provider_id "
            "WHERE provider_id IS NOT NULL AND oauth_sub IS NULL"
        ))
        op.drop_column("users", "provider_id")

    # ── 4. Promote first user to admin if no admin exists ─────────────────────
    conn.execute(sa.text(
        "UPDATE users SET role = 'admin' "
        "WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1) "
        "AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')"
    ))


def downgrade() -> None:
    # Re-add legacy columns
    op.add_column("users", sa.Column("provider", sa.String(50), nullable=False, server_default="local"))
    op.add_column("users", sa.Column("provider_id", sa.String(255), nullable=True))
    # Copy back
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE users SET provider = oauth_provider::text WHERE oauth_provider IS NOT NULL"
    ))
    conn.execute(sa.text(
        "UPDATE users SET provider_id = oauth_sub WHERE oauth_sub IS NOT NULL"
    ))
    # Drop new columns
    op.drop_index("ix_users_oauth_sub", "users")
    op.drop_column("users", "last_seen_at")
    op.drop_column("users", "notification_email")
    op.drop_column("users", "is_onboarded")
    op.drop_column("users", "oauth_sub")
    op.drop_column("users", "oauth_provider")
    op.drop_column("users", "role")
