"""Full-text search over plans, topics, notes and exercises (SQLite FTS5).

The index is maintained incrementally on writes and can be rebuilt completely (`reindex_all`),
which also runs at startup so older databases get indexed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.exercise import Exercise
from app.models.plan import Note, Plan, PlanNode
from app.models.subject import Subject

_TOKEN = re.compile(r"[\w\-]+", re.UNICODE)


def _strip_math(s: str) -> str:
    # keep the words, drop LaTeX control sequences and braces so "fourier" matches inside math too
    return re.sub(r"\\[a-zA-Z]+|[{}$^_]", " ", s or "")


def _upsert(db: Session, kind: str, ref_id: int, subject_id: int, title: str, body: str) -> None:
    db.execute(
        text("DELETE FROM search_index WHERE kind = :kind AND ref_id = :ref_id"),
        {"kind": kind, "ref_id": ref_id},
    )
    db.execute(
        text(
            "INSERT INTO search_index (kind, ref_id, subject_id, title, body) VALUES (:kind, :ref_id, :subject_id, :title, :body)"
        ),
        {
            "kind": kind,
            "ref_id": ref_id,
            "subject_id": subject_id,
            "title": title or "",
            "body": _strip_math(body)[:20000],
        },
    )


def remove(db: Session, kind: str, ref_id: int) -> None:
    db.execute(
        text("DELETE FROM search_index WHERE kind = :kind AND ref_id = :ref_id"),
        {"kind": kind, "ref_id": ref_id},
    )


def index_node(db: Session, node: PlanNode, subject_id: int) -> None:
    body = "\n".join(
        [node.description or "", *(node.objectives or []), *(node.keywords or []), node.key]
    )
    _upsert(db, "node", node.id, subject_id, node.title, body)


def index_note(db: Session, note: Note, node: PlanNode, subject_id: int) -> None:
    if note.content.strip():
        _upsert(db, "note", note.node_id, subject_id, node.title, note.content)
    else:
        remove(db, "note", note.node_id)


def index_exercise(db: Session, ex: Exercise) -> None:
    parts = "\n".join(f"{p.label}) {p.statement}\n{p.solution or ''}" for p in ex.parts)
    body = "\n".join(
        [
            ex.statement or "",
            parts,
            ex.solution or "",
            *(ex.hints or []),
            ex.source_label or "",
            ex.number or "",
        ]
    )
    _upsert(db, "exercise", ex.id, ex.subject_id, ex.title, body)


def index_plan(db: Session, plan: Plan) -> None:
    _upsert(
        db,
        "plan",
        plan.id,
        plan.subject_id,
        plan.title,
        "\n".join([plan.description or "", *(plan.tags or [])]),
    )


def index_subject(db: Session, subject: Subject) -> None:
    _upsert(db, "subject", subject.id, subject.id, subject.name, subject.description or "")


def index_plan_tree(db: Session, plan: Plan) -> None:
    """(Re)index a plan with all of its active nodes and notes; drops archived nodes."""
    index_plan(db, plan)
    for n in plan.nodes:
        if n.archived:
            remove(db, "node", n.id)
            remove(db, "note", n.id)
            continue
        index_node(db, n, plan.subject_id)
        if n.note:
            index_note(db, n.note, n, plan.subject_id)


def reindex_all(db: Session) -> int:
    db.execute(text("DELETE FROM search_index"))
    count = 0
    for subject in db.scalars(select(Subject)):
        index_subject(db, subject)
        count += 1
    for plan in db.scalars(select(Plan)):
        index_plan_tree(db, plan)
        count += 1 + len(plan.nodes)
    for ex in db.scalars(select(Exercise)):
        index_exercise(db, ex)
        count += 1
    db.commit()
    return count


@dataclass
class SearchHit:
    kind: str
    ref_id: int
    subject_id: int
    title: str
    snippet: str
    rank: float


def _fts_query(q: str) -> str:
    tokens = [t for t in _TOKEN.findall(q) if t]
    if not tokens:
        return ""
    # every token as a quoted prefix match; FTS5 ANDs them implicitly
    return " ".join(f'"{t}"*' for t in tokens[:8])


def search(
    db: Session,
    q: str,
    limit: int = 20,
    subject_id: int | None = None,
    kinds: list[str] | None = None,
) -> list[SearchHit]:
    match = _fts_query(q)
    if not match:
        return []
    sql = (
        "SELECT kind, ref_id, subject_id, title, "
        "snippet(search_index, 4, '[', ']', '…', 14) AS snip, bm25(search_index, 0, 0, 0, 3.0, 1.0) AS rank "
        "FROM search_index WHERE search_index MATCH :match"
    )
    params: dict[str, object] = {"match": match, "limit": limit}
    if subject_id is not None:
        sql += " AND subject_id = :subject_id"
        params["subject_id"] = subject_id
    if kinds:
        sql += " AND kind IN (" + ",".join(f"'{k}'" for k in kinds if k.isalpha()) + ")"
    sql += " ORDER BY rank LIMIT :limit"
    rows = db.execute(text(sql), params).all()
    return [
        SearchHit(
            kind=r[0],
            ref_id=int(r[1]),
            subject_id=int(r[2]),
            title=r[3],
            snippet=r[4] or "",
            rank=float(r[5]),
        )
        for r in rows
    ]
