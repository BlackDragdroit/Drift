from fastapi import APIRouter, Query
from sqlalchemy import select

from app.core.deps import DB, CurrentUser
from app.models.plan import PlanNode
from app.models.subject import Subject
from app.schemas.api import SearchHitOut
from app.services import search as searchsvc

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=list[SearchHitOut])
def search(
    db: DB,
    user: CurrentUser,
    q: str = Query(min_length=1, max_length=200),
    subject_id: int | None = None,
    limit: int = Query(20, ge=1, le=50),
) -> list[SearchHitOut]:
    subjects = {s.id: s for s in db.scalars(select(Subject).where(Subject.user_id == user.id))}
    hits = searchsvc.search(db, q, limit=limit, subject_id=subject_id)
    node_ids = [h.ref_id for h in hits if h.kind in ("node", "note")]
    plan_of = (
        dict(
            db.execute(select(PlanNode.id, PlanNode.plan_id).where(PlanNode.id.in_(node_ids))).all()
        )
        if node_ids
        else {}
    )
    out: list[SearchHitOut] = []
    for h in hits:
        subject = subjects.get(h.subject_id)
        if subject is None:
            continue
        plan_id = (
            plan_of.get(h.ref_id)
            if h.kind in ("node", "note")
            else (h.ref_id if h.kind == "plan" else None)
        )
        if h.kind in ("node", "note"):
            url = f"/plans/{plan_id}?node={h.ref_id}"
        elif h.kind == "plan":
            url = f"/plans/{h.ref_id}"
        elif h.kind == "exercise":
            url = f"/subjects/{h.subject_id}?exercise={h.ref_id}"
        else:
            url = f"/subjects/{h.ref_id}"
        out.append(
            SearchHitOut(
                kind=h.kind,
                id=h.ref_id,
                title=h.title,
                snippet=h.snippet,
                subject_id=subject.id,
                subject_name=subject.name,
                subject_color=subject.color,
                plan_id=plan_id,
                node_id=h.ref_id if h.kind in ("node", "note") else None,
                url=url,
            )
        )
    return out


@router.post("/reindex")
def reindex(db: DB, _: CurrentUser) -> dict[str, int]:
    return {"indexed": searchsvc.reindex_all(db)}
