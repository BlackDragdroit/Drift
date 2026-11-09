from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.services import formulas as fsvc
from app.services import generation
from app.services.extraction import Usage
from tests.test_phase4 import import_plan


def node(plan: dict, key: str) -> dict:
    return next(n for n in plan["nodes"] if n["key"] == key)


def test_formula_sheet_crud_order_and_export(auth_client: TestClient):
    plan = import_plan(auth_client)
    cn, lti, fs = (
        node(plan, "complex-numbers"),
        node(plan, "lti-systems"),
        node(plan, "fourier-series"),
    )
    pid = plan["id"]

    # create by node (plan derived) and by plan (unassigned); plan-less request rejected
    r = auth_client.post(
        "/api/formulas",
        json={
            "node_id": lti["id"],
            "title": "Convolution",
            "content": "$$y=x*h$$",
            "note": "LTI only",
        },
    )
    assert r.status_code == 201, r.text
    conv = r.json()
    assert (
        conv["plan_id"] == pid
        and conv["node_title"] == "LTI systems"
        and conv["source"] == "manual"
    )
    euler = auth_client.post(
        "/api/formulas",
        json={"node_id": cn["id"], "title": "Euler", "content": "$$e^{j\\varphi}$$"},
    ).json()
    general = auth_client.post(
        "/api/formulas", json={"plan_id": pid, "title": "", "content": "$$\\delta(t)$$"}
    ).json()
    assert general["node_id"] is None and general["node_title"] is None
    assert auth_client.post("/api/formulas", json={"content": "x"}).status_code == 422
    assert (
        auth_client.post("/api/formulas", json={"plan_id": pid, "content": ""}).status_code == 422
    )

    # listing is grouped in tree order (complex-numbers under foundations comes before lti-systems),
    # unassigned entries last
    ids = [e["id"] for e in auth_client.get("/api/formulas", params={"plan_id": pid}).json()]
    assert ids == [euler["id"], conv["id"], general["id"]]

    # second entry on the same node gets the next sort_order; reorder flips them
    conv2 = auth_client.post(
        "/api/formulas",
        json={"node_id": lti["id"], "title": "Impulse response", "content": "$$h$$"},
    ).json()
    assert conv2["sort_order"] == conv["sort_order"] + 1
    r = auth_client.post(
        "/api/formulas/reorder", params={"plan_id": pid}, json={"ids": [conv2["id"], conv["id"]]}
    )
    assert [e["id"] for e in r.json()][:3] == [euler["id"], conv2["id"], conv["id"]]

    # move an entry to another topic -> re-grouped; moving to a node of another plan is rejected
    moved = auth_client.patch(f"/api/formulas/{general['id']}", json={"node_id": fs["id"]}).json()
    assert moved["node_title"] == "Fourier series"
    other = auth_client.post(
        "/api/plans/import",
        json={
            "content": '{"schemaVersion":1,"id":"other","title":"Other","subject":"Sig","nodes":[{"id":"a","title":"A"}]}'
        },
    ).json()
    other_node = auth_client.get(f"/api/plans/{other['plan_id']}").json()["nodes"][0]
    assert (
        auth_client.patch(
            f"/api/formulas/{euler['id']}", json={"node_id": other_node["id"]}
        ).status_code
        == 422
    )
    # editing text strips whitespace; empty content rejected
    edited = auth_client.patch(
        f"/api/formulas/{euler['id']}", json={"content": "  $$e^{j\\pi}=-1$$ "}
    ).json()
    assert edited["content"] == "$$e^{j\\pi}=-1$$"
    assert (
        auth_client.patch(f"/api/formulas/{euler['id']}", json={"content": ""}).status_code == 422
    )

    # markdown export: one heading per topic in order, titles bold, notes italic
    r = auth_client.get("/api/formulas/export.md", params={"plan_id": pid})
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    md = r.text
    assert md.startswith("# Signals & Systems — Formula sheet")
    assert (
        md.index("## Complex numbers") < md.index("## LTI systems") < md.index("## Fourier series")
    )
    assert "**Convolution**\n\n$$y=x*h$$\n\n*LTI only*" in md
    assert md.count("## ") == 3

    # delete, and plan deletion cascades
    assert auth_client.delete(f"/api/formulas/{conv2['id']}").status_code == 204
    assert len(auth_client.get("/api/formulas", params={"plan_id": pid}).json()) == 3
    assert auth_client.get("/api/formulas", params={"plan_id": 9999}).status_code == 404


def test_formula_harvest_with_mocked_model(auth_client: TestClient, monkeypatch):
    plan = import_plan(auth_client)
    lti = node(plan, "lti-systems")
    pid = plan["id"]
    get_settings().anthropic_api_key = "test-key"
    auth_client.post(
        "/api/formulas", json={"node_id": lti["id"], "title": "Convolution", "content": "$$y=x*h$$"}
    )
    prompts: list[str] = []

    async def fake(*, system, user, schema):
        prompts.append(user)
        assert "formulas" in schema["properties"]
        return {
            "formulas": [
                {
                    "title": "Sifting property",
                    "content": "$$\\int x(\\tau)\\delta(t-\\tau)d\\tau = x(t)$$",
                    "note": "",
                },
                {"title": "Empty", "content": "   ", "note": "dropped"},
            ]
        }, Usage(900, 120)

    monkeypatch.setattr(generation, "structured_call", fake)

    ex = auth_client.get("/api/exercises", params={"subject_id": plan["subject_id"]}).json()[0]
    r = auth_client.post("/api/formulas/harvest", json={"exercise_id": ex["id"]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["plan_id"] == pid and out["node_id"] == lti["id"] and out["exercise_id"] == ex["id"]
    assert [c["title"] for c in out["candidates"]] == ["Sifting property"]
    assert out["input_tokens"] == 900
    assert "Already on the sheet (do not repeat):\n- Convolution" in prompts[0]
    assert "Exercise" in prompts[0] and ex["title"] in prompts[0]
    # nothing was saved by the harvest itself
    assert len(auth_client.get("/api/formulas", params={"plan_id": pid}).json()) == 1

    # topic harvest includes description + linked exercise solutions
    r = auth_client.post("/api/formulas/harvest", json={"node_id": lti["id"]})
    assert r.status_code == 200 and r.json()["exercise_id"] is None
    assert prompts[1].startswith("Material:\n\nTopic: LTI systems")

    assert auth_client.post("/api/formulas/harvest", json={}).status_code == 422
    assert (
        auth_client.post(
            "/api/formulas/harvest", json={"exercise_id": ex["id"], "node_id": lti["id"]}
        ).status_code
        == 422
    )
    # detached exercise -> helpful error instead of a plan-less sheet entry
    loose = auth_client.post(
        "/api/exercises",
        json={"subject_id": plan["subject_id"], "title": "Loose", "statement": "x", "node_ids": []},
    ).json()
    r = auth_client.post("/api/formulas/harvest", json={"exercise_id": loose["id"]})
    assert r.status_code == 422 and "Link the exercise" in r.json()["detail"]


def test_tree_order_and_markdown_helpers():
    class N:
        def __init__(self, id, parent_id, sort_order, archived=False, title=""):
            self.id, self.parent_id, self.sort_order, self.archived, self.title = (
                id,
                parent_id,
                sort_order,
                archived,
                title,
            )

    # orphans (parent archived/missing) are treated as roots; archived nodes are skipped
    nodes = [
        N(1, None, 2),
        N(2, None, 1),
        N(3, 2, 0),
        N(4, 1, 0),
        N(5, 99, 3),
        N(6, None, 0, archived=True),
    ]
    assert [n.id for n in fsvc.tree_order(nodes)] == [2, 3, 1, 4, 5]


def test_attempt_answer_roundtrip(auth_client: TestClient):
    plan = import_plan(auth_client)
    ex = auth_client.get("/api/exercises", params={"subject_id": plan["subject_id"]}).json()[0]
    r = auth_client.post(
        f"/api/exercises/{ex['id']}/attempts",
        json={
            "result": "partial",
            "answer": "$y(t)=\\mathrm{tri}(t)$ (forgot the scaling)",
            "duration_seconds": 90,
        },
    )
    assert r.status_code == 201, r.text
    attempt = r.json()["attempts"][0]
    assert attempt["answer"].startswith("$y(t)") and attempt["notes"] == ""
    # old clients without the field still work
    r = auth_client.post(f"/api/exercises/{ex['id']}/attempts", json={"result": "solved"})
    assert r.json()["attempts"][0]["answer"] == ""
    detail = auth_client.get(f"/api/exercises/{ex['id']}").json()
    assert detail["nodes"] and detail["nodes"][0]["plan_id"] == plan["id"]
    assert {n["id"] for n in detail["nodes"]} == set(detail["node_ids"])
