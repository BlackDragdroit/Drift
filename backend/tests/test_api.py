from fastapi.testclient import TestClient

from tests.conftest import load_fixture


def test_health(client: TestClient):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_auth_flow(client: TestClient):
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
    r = client.post("/api/auth/login", json={"password": "test-password"})
    assert r.status_code == 200 and r.json()["username"] == "owner"
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_csrf_header_required(client: TestClient):
    r = client.post(
        "/api/auth/login", json={"password": "test-password"}, headers={"X-Requested-With": ""}
    )
    assert r.status_code == 403


def test_login_rate_limit(client: TestClient):
    for _ in range(5):
        client.post("/api/auth/login", json={"password": "wrong"})
    assert client.post("/api/auth/login", json={"password": "test-password"}).status_code == 429


def test_full_plan_workflow(auth_client: TestClient):
    c = auth_client
    content = load_fixture("signals_v1.json")

    preview = c.post("/api/plans/import/preview", json={"content": content}).json()
    assert (
        preview["ok"]
        and preview["mode"] == "create"
        and preview["subject_name"] == "Signals & Systems"
    )
    assert preview["counts"]["added"] == 5

    imported = c.post("/api/plans/import", json={"content": content}).json()
    plan_id, subject_id = imported["plan_id"], imported["subject_id"]

    subjects = c.get("/api/subjects").json()
    assert (
        len(subjects) == 1
        and subjects[0]["name"] == "Signals & Systems"
        and subjects[0]["exercise_count"] == 1
    )
    assert subjects[0]["plans"][0]["progress"]["nodes_total"] == 5

    plan = c.get(f"/api/plans/{plan_id}").json()
    assert plan["subject_id"] == subject_id and len(plan["nodes"]) == 5
    cn = next(n for n in plan["nodes"] if n["key"] == "complex-numbers")
    basics = next(n for n in plan["nodes"] if n["key"] == "signals-basics")
    assert cn["ready"] and not basics["ready"] and basics["blocked_by"] == ["complex-numbers"]
    assert cn["flashcard_count"] == 1
    assert next(n for n in plan["nodes"] if n["key"] == "lti-systems")["exercise_count"] == 1

    updated = c.put(f"/api/nodes/{cn['id']}/progress", json={"status": "understood"}).json()
    assert updated["progress"]["status"] == "understood" and updated["progress"]["understood_at"]
    plan = c.get(f"/api/plans/{plan_id}").json()
    assert next(n for n in plan["nodes"] if n["key"] == "signals-basics")["ready"]
    assert plan["progress"]["minutes_done"] == 90

    note = c.put(f"/api/nodes/{cn['id']}/note", json={"content": "Euler rocks"}).json()
    assert note["content"] == "Euler rocks"
    detail = c.get(f"/api/nodes/{cn['id']}").json()
    assert detail["note"]["content"] == "Euler rocks" and detail["has_note"]
    assert [d["key"] for d in detail["dependents"]] == ["signals-basics", "fourier-series"]

    # Merge preview against the existing plan
    preview = c.post(
        "/api/plans/import/preview", json={"content": content, "plan_id": plan_id}
    ).json()
    assert preview["mode"] == "merge" and preview["counts"]["unchanged"] == 5

    export = c.get(f"/api/plans/{plan_id}/export?download=false").json()
    assert export["progress"]["complex-numbers"]["status"] == "understood"
    assert export["notes"]["complex-numbers"] == "Euler rocks"

    exercises = c.get(f"/api/exercises?subject_id={subject_id}").json()
    assert len(exercises) == 1
    ex = c.post(
        f"/api/exercises/{exercises[0]['id']}/attempts", json={"result": "solved", "notes": "easy"}
    ).json()
    assert ex["attempt_count"] == 1 and ex["last_result"] == "solved" and len(ex["parts"]) == 2

    prompt = c.get(
        "/api/plans/generation-prompt",
        params={"topic": "Laplace transform", "exam_date": "2027-02-05"},
    ).json()["prompt"]
    assert "Laplace transform" in prompt and "estimatedMinutes" in prompt and "2027-02-05" in prompt
    assert c.get("/api/plans/schema.json").json()["title"] == "LearningPlan"


def test_import_errors_are_returned_as_issues(auth_client: TestClient):
    bad = '{"schemaVersion": 1, "title": "X", "nodes": [{"id": "a", "title": "A", "prerequisites": ["b"]}]}'
    preview = auth_client.post("/api/plans/import/preview", json={"content": bad}).json()
    assert not preview["ok"]
    assert preview["issues"][0]["severity"] == "error"
    assert "unknown prerequisite 'b'" in preview["issues"][0]["message"]
    r = auth_client.post("/api/plans/import", json={"content": bad})
    assert r.status_code == 422
    r = auth_client.post("/api/plans/import/preview", json={"content": "{not json"})
    assert not r.json()["ok"] and "Invalid JSON" in r.json()["issues"][0]["message"]


def test_markdown_import_via_api(auth_client: TestClient):
    md = "# Analysis 2\n\n## Sequences\ntime: 60\n\n## Series\nprerequisites: Sequences\ntime: 90\n"
    preview = auth_client.post("/api/plans/import/preview", json={"content": md}).json()
    assert (
        preview["ok"]
        and preview["detected_format"] == "markdown"
        and preview["counts"]["added"] == 2
    )
    r = auth_client.post("/api/plans/import", json={"content": md, "new_subject_name": "Analysis"})
    assert r.status_code == 200, r.text
    plan = auth_client.get(f"/api/plans/{r.json()['plan_id']}").json()
    assert plan["title"] == "Analysis 2" and plan["subject_name"] == "Analysis"
