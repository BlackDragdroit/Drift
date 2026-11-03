import io
import zipfile
from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.models.base import utcnow
from app.models.plan import Flashcard
from app.services import backup as backupsvc
from app.services import generation
from app.services.extraction import Usage
from tests.conftest import load_fixture


def import_plan(client: TestClient) -> dict:
    r = client.post("/api/plans/import", json={"content": load_fixture("signals_v1.json")})
    assert r.status_code == 200, r.text
    return client.get(f"/api/plans/{r.json()['plan_id']}").json()


def test_flashcard_review_cycle(auth_client: TestClient, db_session):
    plan = import_plan(auth_client)
    cn = next(n for n in plan["nodes"] if n["key"] == "complex-numbers")

    queue = auth_client.get("/api/flashcards/due").json()
    assert queue["new"] == 1 and queue["due"] == 0 and queue["total"] == 1
    card = queue["cards"][0]
    assert (
        card["front"] == "Euler?"
        and card["node_title"] == "Complex numbers"
        and card["source"] == "plan"
    )
    assert set(card["intervals"]) == {"1", "2", "3", "4"}

    # Good -> scheduled in the future, no longer due; retrievability known
    r = auth_client.post(
        f"/api/flashcards/{card['id']}/review", json={"rating": 3, "duration_ms": 4200}
    )
    assert r.status_code == 200
    reviewed = r.json()
    assert (
        reviewed["reps"] == 1
        and reviewed["due"] is not None
        and reviewed["retrievability"] is not None
    )
    assert auth_client.get("/api/flashcards/due").json()["cards"] == []

    # Make it due again, fail it -> still due soon, lapses counted once it was in review state
    fc = db_session.get(Flashcard, card["id"])
    fc.due = utcnow() - timedelta(minutes=1)
    db_session.commit()
    queue = auth_client.get("/api/flashcards/due").json()
    assert queue["due"] == 1
    again = auth_client.post(f"/api/flashcards/{card['id']}/review", json={"rating": 1}).json()
    assert again["reps"] == 2
    dash = auth_client.get("/api/dashboard").json()
    assert "flashcards_due" in dash and "flashcards_new" in dash

    # manual card + edit + delete, scoped by node
    created = auth_client.post(
        "/api/flashcards", json={"node_id": cn["id"], "front": "What is $j^2$?", "back": "$-1$"}
    ).json()
    assert created["source"] == "manual"
    assert len(auth_client.get(f"/api/flashcards?node_id={cn['id']}").json()) == 2
    assert (
        auth_client.patch(f"/api/flashcards/{created['id']}", json={"back": "$j^2 = -1$"}).json()[
            "back"
        ]
        == "$j^2 = -1$"
    )
    assert auth_client.delete(f"/api/flashcards/{created['id']}").status_code == 204
    assert auth_client.get("/api/flashcards/due", params={"node_id": cn["id"]}).json()["total"] == 1


def test_generate_cards_and_similar_exercise_with_mocked_model(
    auth_client: TestClient, monkeypatch
):
    plan = import_plan(auth_client)
    cn = next(n for n in plan["nodes"] if n["key"] == "complex-numbers")
    get_settings().anthropic_api_key = "test-key"
    prompts: list[str] = []

    async def fake(*, system, user, schema):
        prompts.append(user)
        if "cards" in schema["properties"]:
            return {
                "cards": [
                    {"front": "Polar form of $z$?", "back": "$z = re^{j\\theta}$"},
                    {"front": "", "back": "x"},
                    {"front": "Euler?", "back": "dup"},
                ]
            }, Usage(300, 80)
        return {
            "title": "Convolution of two triangles",
            "statement": "Let $x(t)=\\mathrm{tri}(t)$.",
            "parts": [{"label": "a", "statement": "Sketch.", "solution": "..."}],
            "hints": [],
            "solution": None,
            "difficulty": 2,
        }, Usage(500, 200)

    monkeypatch.setattr(generation, "structured_call", fake)

    r = auth_client.post(f"/api/flashcards/generate/{cn['id']}", json={"count": 3})
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 2  # empty front dropped
    assert "Existing cards (do not duplicate):\n- Euler?" in prompts[0]
    cards = auth_client.get(f"/api/flashcards?node_id={cn['id']}").json()
    assert {c["source"] for c in cards} == {"plan", "generated"} and len(cards) == 3

    ex = auth_client.get(f"/api/exercises?subject_id={plan['subject_id']}").json()[0]
    r = auth_client.post(f"/api/system/exercises/{ex['id']}/similar")
    assert r.status_code == 200, r.text
    new = r.json()
    assert new["title"] == "Convolution of two triangles" and new["tags"] == ["generated"]
    assert new["source_label"].startswith("Variation of") and new["node_keys"] == ex["node_keys"]
    assert len(new["parts"]) == 1 and new["id"] != ex["id"]
    assert "Original exercise" in prompts[1] and "Create one variation" in prompts[1]


def test_backup_and_restore_roundtrip(auth_client: TestClient, tmp_path):
    plan = import_plan(auth_client)
    cn = next(n for n in plan["nodes"] if n["key"] == "complex-numbers")
    auth_client.put(f"/api/nodes/{cn['id']}/note", json={"content": "keep me"})
    # a file in uploads must travel with the backup
    uploads = get_settings().uploads_dir
    (uploads / "figures").mkdir(parents=True, exist_ok=True)
    (uploads / "figures" / "x.png").write_bytes(b"\x89PNGfake")
    (uploads / "pages").mkdir(exist_ok=True)
    (uploads / "pages" / "cache.png").write_bytes(b"cache")

    stats = auth_client.get("/api/system/stats").json()
    assert stats["db_bytes"] > 0 and stats["uploads_bytes"] > 0

    r = auth_client.get("/api/system/backup")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(zf.namelist())
    assert {"manifest.json", "app.db", "uploads/figures/x.png"} <= names
    assert "uploads/pages/cache.png" not in names  # page previews are a cache
    zip_path = tmp_path / "backup.zip"
    zip_path.write_bytes(r.content)

    # destroy state, then restore
    auth_client.put(f"/api/nodes/{cn['id']}/note", json={"content": "overwritten"})
    (uploads / "figures" / "x.png").unlink()
    with open(zip_path, "rb") as f:
        r = auth_client.post(
            "/api/system/restore", files={"file": ("backup.zip", f, "application/zip")}
        )
    assert r.status_code == 200, r.text
    assert r.json()["previous_kept_as"].startswith("app.db.bak-") and r.json()["upload_files"] == 1
    assert auth_client.get(f"/api/nodes/{cn['id']}").json()["note"]["content"] == "keep me"
    assert (uploads / "figures" / "x.png").read_bytes() == b"\x89PNGfake"
    assert any(p.name.startswith("app.db.bak-") for p in get_settings().data_dir.iterdir())
    # search index was rebuilt from the restored database
    assert any(
        h["kind"] == "note" for h in auth_client.get("/api/search", params={"q": "keep"}).json()
    )

    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(bad, "w") as z:
        z.writestr("hello.txt", "nope")
    with open(bad, "rb") as f:
        assert (
            auth_client.post(
                "/api/system/restore", files={"file": ("bad.zip", f, "application/zip")}
            ).status_code
            == 422
        )
    assert backupsvc.inspect_backup(zip_path)["manifest"]["version"] == 1
