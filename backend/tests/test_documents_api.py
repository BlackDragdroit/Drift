import json
import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.models.document import ExtractionJob
from app.services import extraction, jobs
from app.services.extraction import Usage
from tests.conftest import load_fixture
from tests.pdf_fixtures import make_scanned_pdf, make_text_pdf


@pytest.fixture
def subject_with_plan(auth_client: TestClient) -> dict:
    r = auth_client.post("/api/plans/import", json={"content": load_fixture("signals_v1.json")})
    assert r.status_code == 200, r.text
    return r.json()


def upload(client: TestClient, path, subject_id: int, title: str | None = None):
    with open(path, "rb") as f:
        data = {"subject_id": str(subject_id)}
        if title:
            data["title"] = title
        return client.post(
            "/api/documents", files={"file": (path.name, f, "application/pdf")}, data=data
        )


def fake_caller(seen: list):
    async def _call(*, model, system, content, api_key):
        seen.append(content)
        prompt = content[-1]["text"]
        fixture = (
            "extraction_chunk_1.json" if "pages 1 to 2" in prompt else "extraction_chunk_2.json"
        )
        return json.loads(load_fixture(fixture)), Usage(1000, 200)

    return _call


def wait_for(
    client: TestClient, job_id: int, states=("review", "failed", "cancelled"), timeout=20.0
) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in states:
            return job
        time.sleep(0.1)
    raise AssertionError(f"job {job_id} did not finish: {job}")


def test_upload_inspect_pages_and_dedupe(auth_client: TestClient, subject_with_plan, tmp_path):
    sid = subject_with_plan["subject_id"]
    pdf = make_text_pdf(tmp_path / "Übungsblatt 3.pdf", pages=3)
    r = upload(auth_client, pdf, sid)
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["page_count"] == 3 and doc["has_text_layer"] and doc["title"] == "Übungsblatt 3"
    assert upload(auth_client, pdf, sid).json()["id"] == doc["id"]  # same content -> same document
    assert len(auth_client.get(f"/api/documents?subject_id={sid}").json()) == 1

    page = auth_client.get(f"/api/documents/{doc['id']}/pages/2")
    assert page.status_code == 200 and page.headers["content-type"] == "image/png"
    assert auth_client.get(f"/api/documents/{doc['id']}/pages/9").status_code == 404
    assert (
        auth_client.get(f"/api/documents/{doc['id']}/file").headers["content-type"]
        == "application/pdf"
    )

    bad = tmp_path / "notes.txt"
    bad.write_text("hello")
    assert upload(auth_client, bad, sid).status_code == 415
    assert auth_client.get("/api/files/../app.db").status_code == 404  # no path traversal


def test_extraction_requires_api_key(auth_client: TestClient, subject_with_plan, tmp_path):
    get_settings().anthropic_api_key = None
    doc = upload(
        auth_client, make_text_pdf(tmp_path / "a.pdf", pages=1), subject_with_plan["subject_id"]
    ).json()
    r = auth_client.post(f"/api/documents/{doc['id']}/extract", json={})
    assert r.status_code == 400 and "ANTHROPIC_API_KEY" in r.json()["detail"]


def test_extraction_end_to_end(auth_client: TestClient, subject_with_plan, tmp_path, monkeypatch):
    sid, plan_id = subject_with_plan["subject_id"], subject_with_plan["plan_id"]
    get_settings().anthropic_api_key = "test-key"
    get_settings().extract_chunk_pages = 2
    seen: list = []
    monkeypatch.setattr(extraction, "call_model", fake_caller(seen))

    doc = upload(auth_client, make_text_pdf(tmp_path / "sheet.pdf", pages=4), sid).json()
    r = auth_client.post(f"/api/documents/{doc['id']}/extract", json={"plan_id": plan_id})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending" and r.json()["page_to"] == 4

    job = wait_for(auth_client, r.json()["id"])
    assert job["status"] == "review", job
    assert job["chunks_total"] == 2 and job["chunks_done"] == 2 and job["used_images"] is False
    assert job["input_tokens"] == 2000 and job["estimated_cost_usd"] is not None
    assert "Solutions for exercise 1 are printed inline." in job["notes"]
    assert len(seen) == 2 and seen[0][0]["type"] == "document"

    drafts = job["draft"]
    assert [d["number"] for d in drafts] == ["1", "2", "3"]
    assert drafts[0]["figures"][0]["url"].startswith("/api/files/figures/")
    assert auth_client.get(drafts[0]["figures"][0]["url"]).status_code == 200
    assert drafts[0]["node_ids"] == [1]  # 999 is not a node of this plan
    assert [p["label"] for p in drafts[1]["parts"]] == [
        "a",
        "b",
    ]  # stitched across the chunk boundary

    # review edits persist
    drafts[0]["title"] = "Faltung zweier Rechtecke"
    r = auth_client.put(f"/api/jobs/{job['id']}/draft", json={"exercises": drafts})
    assert r.status_code == 200 and r.json()["draft"][0]["title"] == "Faltung zweier Rechtecke"

    # manual crop
    fig = auth_client.post(
        f"/api/jobs/{job['id']}/figures",
        json={"page": 1, "bbox": [0.2, 0.3, 0.8, 0.65], "caption": "manual"},
    ).json()
    assert fig["path"].startswith("figures/") and fig["url"].endswith(fig["path"])
    assert (
        auth_client.post(
            f"/api/jobs/{job['id']}/figures", json={"page": 1, "bbox": [0.5, 0.5, 0.501, 0.501]}
        ).status_code
        == 422
    )
    drafts[1]["figures"].append(fig)
    drafts.append(
        {**drafts[2], "id": "empty", "statement": "", "parts": [], "solution": None}
    )  # skipped on commit

    r = auth_client.post(f"/api/jobs/{job['id']}/commit", json={"exercises": drafts})
    assert r.status_code == 200, r.text
    ids = r.json()["exercise_ids"]
    assert len(ids) == 3 and r.json()["skipped"] == 1
    job = auth_client.get(f"/api/jobs/{job['id']}").json()
    assert job["status"] == "done" and job["draft"] is None and job["created_exercise_ids"] == ids
    assert (
        auth_client.post(f"/api/jobs/{job['id']}/commit", json={"exercises": []}).status_code == 409
    )

    ex = auth_client.get(f"/api/exercises/{ids[0]}").json()
    assert (
        ex["title"] == "Faltung zweier Rechtecke"
        and ex["source_label"] == "sheet · p. 1"
        and ex["page_from"] == 1
    )
    assert ex["figures"][0]["url"].startswith("/api/files/figures/") and len(ex["parts"]) == 2
    assert ex["node_keys"] == ["foundations"]
    second = auth_client.get(f"/api/exercises/{ids[1]}").json()
    assert (
        second["source_label"] == "sheet · pp. 2-3" and second["figures"][0]["caption"] == "manual"
    )
    assert auth_client.get(f"/api/documents/{doc['id']}").json()["exercise_count"] == 3

    # editing after save
    r = auth_client.patch(
        f"/api/exercises/{ex['id']}",
        json={
            "title": "Edited",
            "parts": [{"label": "a", "statement": "only one"}],
            "node_ids": [2],
        },
    )
    assert (
        r.json()["title"] == "Edited"
        and len(r.json()["parts"]) == 1
        and r.json()["node_keys"] == ["complex-numbers"]
    )
    assert auth_client.delete(f"/api/exercises/{ex['id']}").status_code == 204
    assert auth_client.get(f"/api/documents/{doc['id']}").json()["exercise_count"] == 2

    # manual exercise creation
    r = auth_client.post(
        "/api/exercises",
        json={"subject_id": sid, "title": "Own", "statement": "$x^2$", "node_ids": [1]},
    )
    assert r.status_code == 201 and r.json()["source_label"] == "Manual"


def test_scanned_pdf_sends_page_images(
    auth_client: TestClient, subject_with_plan, tmp_path, monkeypatch
):
    get_settings().anthropic_api_key = "test-key"
    seen: list = []

    async def caller(*, model, system, content, api_key):
        seen.append(content)
        return {"exercises": [], "notes": ["nothing here"]}, Usage(10, 1)

    monkeypatch.setattr(extraction, "call_model", caller)
    doc = upload(
        auth_client,
        make_scanned_pdf(tmp_path / "scan.pdf", pages=2),
        subject_with_plan["subject_id"],
    ).json()
    assert doc["has_text_layer"] is False
    r = auth_client.post(f"/api/documents/{doc['id']}/extract", json={})
    job = wait_for(auth_client, r.json()["id"])
    assert job["status"] == "review" and job["used_images"] is True and job["draft"] == []
    assert [b["type"] for b in seen[0]] == ["image", "image", "text"]


def test_model_failure_marks_job_failed(
    auth_client: TestClient, subject_with_plan, tmp_path, monkeypatch
):
    get_settings().anthropic_api_key = "test-key"

    async def boom(*, model, system, content, api_key):
        raise RuntimeError("rate limited")

    monkeypatch.setattr(extraction, "call_model", boom)
    doc = upload(
        auth_client, make_text_pdf(tmp_path / "x.pdf", pages=1), subject_with_plan["subject_id"]
    ).json()
    r = auth_client.post(f"/api/documents/{doc['id']}/extract", json={})
    job = wait_for(auth_client, r.json()["id"])
    assert job["status"] == "failed" and "rate limited" in job["error"]


def test_cancel_pending_and_recover_stale(
    auth_client: TestClient, subject_with_plan, tmp_path, db_session
):
    doc = upload(
        auth_client, make_text_pdf(tmp_path / "x.pdf", pages=1), subject_with_plan["subject_id"]
    ).json()
    pending = ExtractionJob(
        document_id=doc["id"], model="m", page_from=1, page_to=1, status="pending"
    )
    running = ExtractionJob(
        document_id=doc["id"], model="m", page_from=1, page_to=1, status="running"
    )
    db_session.add_all([pending, running])
    db_session.commit()
    jobs.runner.cancel(pending.id)
    assert auth_client.get(f"/api/jobs/{pending.id}").json()["status"] == "cancelled"
    assert jobs.recover_stale_jobs(db_session) == 1
    assert "restart" in auth_client.get(f"/api/jobs/{running.id}").json()["error"]
    assert auth_client.delete(f"/api/jobs/{running.id}").status_code == 204
