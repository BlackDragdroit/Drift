"""formula sheet and attempt answers

Revision ID: 20ed362af58f
Revises: 04fa37225d81
Create Date: 2026-11-09 15:39:04.452828

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20ed362af58f"
down_revision: str | None = "04fa37225d81"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "formula_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("node_id", sa.Integer(), nullable=True),
        sa.Column("exercise_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["exercise_id"], ["exercises.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["node_id"], ["plan_nodes.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["plan_id"], ["plans.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("formula_entries", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_formula_entries_node_id"), ["node_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_formula_entries_plan_id"), ["plan_id"], unique=False)

    with op.batch_alter_table("attempts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("answer", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("attempts", schema=None) as batch_op:
        batch_op.drop_column("answer")

    with op.batch_alter_table("formula_entries", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_formula_entries_plan_id"))
        batch_op.drop_index(batch_op.f("ix_formula_entries_node_id"))

    op.drop_table("formula_entries")
