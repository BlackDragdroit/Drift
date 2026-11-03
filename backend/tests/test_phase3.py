from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.subjects import create_subject
from app.core.security import ensure_owner_user
from app.models.activity import ActivityEvent, StudySession
from app.models.base import utcnow
from app.models.exercise import Attempt, Exercise
from app.services import activity
from app.services import search as searchsvc
from app.services.plan_import import ImportOptions, apply_import, load_plan, set_status
from app.services.plan_validation import validate_plan
from app.services.practice import PracticeFilters, build_queue
from app.services.schedule import build_schedule
from tests.conftest import load_fixture
from tests.test_plan_merge import fixture_doc


def make_plan(db, exam_in_days: int | None = 10, capacity: int = 120):
    user = ensure_owner_user(db)
    subject = create_subject(db, user.id, "S&S")
    doc = fixture_doc()
    if exam_in_days is None:
        doc.pop("exam", None)
    else:
        doc["exam"] = {"date": (date.today() + timedelta(days=exam_in_days)).isoformat()}
    result = validate_plan(doc)
    plan = apply_import(db, result.plan, subject, options=ImportOptions())
    plan.daily_capacity_minutes = capacity
    db.commit()
    return load_plan(db, plan.id)


def node(plan, key):
    return next(n for n in plan.nodes if n.key == key)


# ----------------------------------------------------------------------------- schedule


def test_schedule_respects_prerequisites_and_exam(db_session):
    plan = make_plan(db_session, exam_in_days=10, capacity=120)
    s = build_schedule(plan)
    assert s.summary.remaining_minutes == 90 + 120 + 240 + 180  # grouping node excluded
    assert s.summary.days_left == 10 and s.summary.study_days == 9
    assert s.summary.needed_per_day == 70 and not s.summary.behind
    order = [n.key for d in s.days for n in d.nodes]
    assert (
        order.index("complex-numbers") < order.index("signals-basics") < order.index("lti-systems")
    )
    assert s.days[0].date == date.today()
    assert s.summary.finish_date <= plan.exam_date
    assert all(d.minutes <= max(70, max(n.minutes for n in d.nodes)) for d in s.days)


def test_schedule_flags_behind_and_done_nodes_disappear(db_session):
    plan = make_plan(db_session, exam_in_days=2, capacity=60)
    s = build_schedule(plan)
    assert s.summary.study_days == 2 and s.summary.needed_per_day == 315 and s.summary.behind
    set_status(node(plan, "complex-numbers"), "understood")
    set_status(node(plan, "signals-basics"), "in_progress")
    db_session.commit()
    s = build_schedule(load_plan(db_session, plan.id))
    assert s.summary.remaining_minutes == 120 + 240 + 180 and s.summary.in_progress == 1
    assert s.days[0].nodes[0].key == "signals-basics"  # started work first
    assert s.days[0].nodes[0].ready is True


def test_schedule_without_exam_uses_capacity(db_session):
    plan = make_plan(db_session, exam_in_days=None, capacity=90)
    s = build_schedule(plan)
    assert s.summary.exam_date is None and s.summary.days_left is None
    assert s.summary.study_days == 7 and s.summary.needed_per_day == 90
    assert len(s.days) >= 4 and s.summary.finish_date == s.days[-1].date


def test_schedule_endpoint_and_dashboard_due_today(auth_client: TestClient):
    content = load_fixture("signals_v1.json")
    r = auth_client.post(
        "/api/plans/import",
        json={
            "content": content.replace(
                '"2027-02-05"', f'"{(date.today() + timedelta(days=5)).isoformat()}"'
            )
        },
    )
    plan_id = r.json()["plan_id"]
    s = auth_client.get(f"/api/plans/{plan_id}/schedule").json()
    assert s["summary"]["days_left"] == 5 and s["days"][0]["date"] == date.today().isoformat()
    dash = auth_client.get("/api/dashboard").json()
    assert dash["exams"][0]["needed_per_day"] == s["summary"]["needed_per_day"]
    assert [n["key"] for n in dash["due_today"]] == [n["key"] for n in s["days"][0]["nodes"]]
    assert all(n["node_id"] not in {d["node_id"] for d in dash["due_today"]} for n in dash["ready"])


# ----------------------------------------------------------------------------- search


def test_search_index_and_query(auth_client: TestClient):
    r = auth_client.post("/api/plans/import", json={"content": load_fixture("signals_v1.json")})
    plan = auth_client.get(f"/api/plans/{r.json()['plan_id']}").json()
    cn = next(n for n in plan["nodes"] if n["key"] == "complex-numbers")
    hits = auth_client.get("/api/search", params={"q": "polar"}).json()
    assert (
        hits
        and hits[0]["kind"] == "node"
        and hits[0]["node_id"] == cn["id"]
        and hits[0]["url"].endswith(f"?node={cn['id']}")
    )
    assert "[Polar]" in hits[0]["snippet"] or "[polar" in hits[0]["snippet"].lower()
    # notes are indexed on save, exercises by content, prefix matching works
    auth_client.put(
        f"/api/nodes/{cn['id']}/note", json={"content": "Remember Eulers identity for phasors"}
    )
    kinds = {h["kind"] for h in auth_client.get("/api/search", params={"q": "euler"}).json()}
    assert "note" in kinds
    ex_hits = auth_client.get("/api/search", params={"q": "trapez"}).json()
    assert any(h["kind"] == "exercise" for h in ex_hits)
    assert auth_client.get("/api/search", params={"q": "Systems"}).json()[0]["kind"] in (
        "subject",
        "plan",
    )
    # deleting removes from the index
    ex_id = next(h["id"] for h in ex_hits if h["kind"] == "exercise")
    auth_client.delete(f"/api/exercises/{ex_id}")
    assert not any(
        h["kind"] == "exercise"
        for h in auth_client.get("/api/search", params={"q": "trapez"}).json()
    )
    assert auth_client.get("/api/search", params={"q": "***"}).json() == []


def test_reindex_all_rebuilds(db_session):
    plan = make_plan(db_session, exam_in_days=None)
    assert searchsvc.reindex_all(db_session) >= 1 + len(plan.nodes)
    hits = searchsvc.search(db_session, "fourier")
    assert any(h.kind == "node" and h.title == "Fourier series" for h in hits)


# ----------------------------------------------------------------------------- practice


def seed_exercises(db, subject_id: int, node_ids: list[int], n: int = 6) -> list[Exercise]:
    from app.models.exercise import ExerciseNodeLink

    out = []
    for i in range(n):
        ex = Exercise(subject_id=subject_id, title=f"Ex {i}", statement="x", difficulty=(i % 5) + 1)
        ex.node_links = [ExerciseNodeLink(node_id=node_ids[i % len(node_ids)])]
        db.add(ex)
        out.append(ex)
    db.commit()
    return out


def test_practice_queue_filters_and_modes(db_session):
    plan = make_plan(db_session, exam_in_days=None)
    ids = [node(plan, "complex-numbers").id, node(plan, "lti-systems").id]
    exercises = seed_exercises(db_session, plan.subject_id, ids, n=6)
    exercises[0].attempts.append(Attempt(result="solved"))
    exercises[1].attempts.append(Attempt(result="failed"))
    db_session.commit()

    seq = build_queue(
        db_session, PracticeFilters(subject_id=plan.subject_id, mode="sequential", limit=10)
    )
    assert len(seq) == 7  # 6 seeded + 1 embedded from the plan
    assert build_queue(
        db_session,
        PracticeFilters(subject_id=plan.subject_id, node_ids=[ids[0]], mode="sequential"),
    ) == [e.id for e in exercises if e.node_links[0].node_id == ids[0]]
    unsolved = build_queue(
        db_session,
        PracticeFilters(
            subject_id=plan.subject_id, unsolved_only=True, mode="sequential", limit=10
        ),
    )
    assert exercises[0].id not in unsolved and exercises[1].id in unsolved
    hard = build_queue(
        db_session, PracticeFilters(subject_id=plan.subject_id, difficulty_min=4, mode="sequential")
    )
    assert all(
        e.difficulty is None or e.difficulty >= 4
        for e in db_session.scalars(select(Exercise).where(Exercise.id.in_(hard)))
    )
    random_a = build_queue(
        db_session, PracticeFilters(subject_id=plan.subject_id, mode="random", seed=1, limit=10)
    )
    random_b = build_queue(
        db_session, PracticeFilters(subject_id=plan.subject_id, mode="random", seed=1, limit=10)
    )
    assert random_a == random_b and sorted(random_a) == sorted(seq)
    exam = build_queue(
        db_session, PracticeFilters(subject_id=plan.subject_id, mode="exam", seed=7, limit=4)
    )
    assert len(exam) == 4 and len(set(exam)) == 4
    diffs = [db_session.get(Exercise, i).difficulty or 3 for i in exam]
    assert diffs == sorted(diffs)  # exam mix goes easy -> hard


def test_practice_endpoint(auth_client: TestClient):
    r = auth_client.post("/api/plans/import", json={"content": load_fixture("signals_v1.json")})
    sid = r.json()["subject_id"]
    q = auth_client.post(
        "/api/practice/queue", json={"subject_id": sid, "mode": "exam", "limit": 5}
    ).json()
    assert q["total_available"] == 1 and len(q["exercise_ids"]) == 1
    assert (
        auth_client.post("/api/practice/queue", json={"subject_id": 999}).json()["exercise_ids"]
        == []
    )


# ----------------------------------------------------------------------------- sessions, streak, weak spots


def test_sessions_and_streak(auth_client: TestClient, db_session):
    r = auth_client.post("/api/plans/import", json={"content": load_fixture("signals_v1.json")})
    plan = auth_client.get(f"/api/plans/{r.json()['plan_id']}").json()
    cn = next(n for n in plan["nodes"] if n["key"] == "complex-numbers")

    s = auth_client.post("/api/sessions/start", json={"node_id": cn["id"]}).json()
    assert s["ended_at"] is None and s["node_title"] == "Complex numbers"
    assert auth_client.get("/api/sessions/active").json()["id"] == s["id"]
    assert auth_client.get("/api/dashboard").json()["active_session"]["id"] == s["id"]
    # starting another one closes the first
    s2 = auth_client.post("/api/sessions/start", json={"subject_id": plan["subject_id"]}).json()
    assert auth_client.get("/api/sessions/active").json()["id"] == s2["id"]
    assert (
        auth_client.get(f"/api/sessions?node_id={cn['id']}").json()[0]["duration_seconds"]
        is not None
    )

    # backdate the running session to 25 minutes and stop -> counted as activity + actual minutes on the node
    row = db_session.get(StudySession, s2["id"])
    row.started_at = utcnow() - timedelta(minutes=25)
    db_session.commit()
    stopped = auth_client.post(f"/api/sessions/{s2['id']}/stop", json={"note": "good"}).json()
    assert 24 * 60 <= stopped["duration_seconds"] <= 26 * 60 and stopped["note"] == "good"
    assert auth_client.get("/api/sessions/active").json() is None

    # streak: today active; add an event yesterday and 2 days ago -> streak 3
    for days in (1, 2):
        db_session.add(ActivityEvent(kind="status", created_at=utcnow() - timedelta(days=days)))
    db_session.commit()
    dash = auth_client.get("/api/dashboard").json()
    assert (
        dash["streak"]["current"] == 3
        and dash["streak"]["active_today"]
        and dash["streak"]["minutes_today"] >= 25
    )
    assert len(dash["streak"]["days"]) == 3

    info = activity.streak(db_session)
    assert info.longest >= 3

    # status change + note are activity too (already logged by the API); the node shows actual minutes
    auth_client.put(f"/api/nodes/{cn['id']}/progress", json={"status": "in_progress"})
    assert (
        db_session.scalar(select(ActivityEvent).where(ActivityEvent.kind == "status")) is not None
    )
    s3 = auth_client.post("/api/sessions/start", json={"node_id": cn["id"]}).json()
    db_session.get(StudySession, s3["id"]).started_at = utcnow() - timedelta(minutes=10)
    db_session.commit()
    auth_client.post(f"/api/sessions/{s3['id']}/stop", json={})
    assert auth_client.get(f"/api/nodes/{cn['id']}").json()["actual_minutes"] >= 10


def test_weak_spots_and_retry_list(auth_client: TestClient, db_session):
    r = auth_client.post("/api/plans/import", json={"content": load_fixture("signals_v1.json")})
    sid = r.json()["subject_id"]
    ex = auth_client.get(f"/api/exercises?subject_id={sid}").json()[0]
    for result in ("failed", "failed", "partial", "solved"):
        auth_client.post(f"/api/exercises/{ex['id']}/attempts", json={"result": result})
    spots = auth_client.get("/api/dashboard").json()["weak_spots"]
    assert (
        spots
        and spots[0]["key"] == "lti-systems"
        and spots[0]["failed"] == 2
        and spots[0]["partial"] == 1
        and spots[0]["attempts"] == 4
    )
    # latest attempt is solved -> not in the retry list
    assert auth_client.get("/api/dashboard").json()["retry_exercises"] == []
    auth_client.post(f"/api/exercises/{ex['id']}/attempts", json={"result": "failed"})
    retry = auth_client.get("/api/dashboard").json()["retry_exercises"]
    assert [e["id"] for e in retry] == [ex["id"]] and retry[0]["node_keys"] == ["lti-systems"]
