import json

import pytest

from app.schemas.plan_format import plan_json_schema
from app.services.plan_validation import validate_plan
from tests.conftest import load_fixture


def base_plan(**overrides):
    doc = {
        "schemaVersion": 1,
        "id": "test-plan",
        "title": "Test plan",
        "nodes": [
            {"id": "a", "title": "A", "estimatedMinutes": 30},
            {"id": "b", "title": "B", "estimatedMinutes": 30, "prerequisites": ["a"]},
        ],
    }
    doc.update(overrides)
    return doc


def messages(result):
    return [i.message for i in result.issues]


def test_valid_fixture_passes():
    result = validate_plan(json.loads(load_fixture("signals_v1.json")))
    assert result.ok, messages(result)
    assert result.plan is not None
    assert [n.id for n in result.plan.nodes][:2] == ["foundations", "complex-numbers"]
    fourier = next(n for n in result.plan.nodes if n.id == "fourier-series")
    assert [(p.id, p.kind) for p in fourier.prerequisites] == [
        ("complex-numbers", "required"),
        ("lti-systems", "recommended"),
    ]


def test_unknown_prerequisite_is_reported_with_path_and_suggestion():
    doc = base_plan(
        nodes=[
            {"id": "complex-numbers", "title": "Complex numbers", "estimatedMinutes": 10},
            {
                "id": "fourier-series",
                "title": "Fourier",
                "estimatedMinutes": 10,
                "prerequisites": ["complex-numberz"],
            },
        ]
    )
    result = validate_plan(doc)
    assert not result.ok
    [err] = result.errors
    assert err.path == "$.nodes[1].prerequisites[0]"
    assert "node 'fourier-series' references unknown prerequisite 'complex-numberz'" in err.message
    assert "Did you mean 'complex-numbers'?" in err.message


def test_prerequisite_cycle_is_detected():
    doc = base_plan(
        nodes=[
            {"id": "a", "title": "A", "estimatedMinutes": 10, "prerequisites": ["c"]},
            {"id": "b", "title": "B", "estimatedMinutes": 10, "prerequisites": ["a"]},
            {"id": "c", "title": "C", "estimatedMinutes": 10, "prerequisites": ["b"]},
        ]
    )
    result = validate_plan(doc)
    assert not result.ok
    assert any("cycle" in m.lower() for m in messages(result))


def test_parent_cycle_and_unknown_parent():
    result = validate_plan(
        base_plan(
            nodes=[
                {"id": "a", "title": "A", "parent": "b", "estimatedMinutes": 10},
                {"id": "b", "title": "B", "parent": "a", "estimatedMinutes": 10},
            ]
        )
    )
    assert any("Parent cycle" in m for m in messages(result))
    result = validate_plan(
        base_plan(nodes=[{"id": "a", "title": "A", "parent": "nope", "estimatedMinutes": 10}])
    )
    assert any("unknown parent 'nope'" in m for m in messages(result))


def test_duplicate_ids_and_self_prerequisite():
    result = validate_plan(
        base_plan(
            nodes=[
                {"id": "a", "title": "A", "estimatedMinutes": 10},
                {"id": "a", "title": "A again", "estimatedMinutes": 10, "prerequisites": ["a"]},
            ]
        )
    )
    msgs = messages(result)
    assert any("Duplicate node id 'a'" in m for m in msgs)
    assert any("lists itself as a prerequisite" in m for m in msgs)


def test_missing_ids_are_generated_and_title_references_resolve():
    doc = base_plan(
        nodes=[
            {"title": "Komplexe Zahlen & Euler", "estimatedMinutes": 10},
            {
                "title": "Fourier-Reihen",
                "estimatedMinutes": 10,
                "prerequisites": ["Komplexe Zahlen & Euler"],
            },
        ]
    )
    result = validate_plan(doc)
    assert result.ok, messages(result)
    ids = [n.id for n in result.plan.nodes]
    assert ids == ["komplexe-zahlen-euler", "fourier-reihen"]
    assert result.plan.nodes[1].prerequisites[0].id == "komplexe-zahlen-euler"
    assert any("matched node 'komplexe-zahlen-euler' by title" in m for m in messages(result))
    assert all(i.severity == "warning" for i in result.issues)


def test_missing_schema_version_is_a_warning_and_unsupported_is_an_error():
    doc = base_plan()
    del doc["schemaVersion"]
    result = validate_plan(doc)
    assert result.ok
    assert any("assuming 1" in m for m in messages(result))
    assert not validate_plan(base_plan(schemaVersion=99)).ok


def test_nested_children_are_flattened():
    doc = base_plan(
        nodes=[
            {
                "id": "root",
                "title": "Root",
                "children": [
                    {
                        "id": "kid",
                        "title": "Kid",
                        "estimatedMinutes": 10,
                        "children": [{"id": "grandkid", "title": "G", "estimatedMinutes": 5}],
                    }
                ],
            },
        ]
    )
    result = validate_plan(doc)
    assert result.ok, messages(result)
    by_id = {n.id: n for n in result.plan.nodes}
    assert by_id["kid"].parent == "root"
    assert by_id["grandkid"].parent == "kid"


def test_estimated_minutes_accepts_human_strings():
    doc = base_plan(
        nodes=[
            {"id": "a", "title": "A", "estimatedMinutes": "1h30"},
            {"id": "b", "title": "B", "estimatedMinutes": "45 min"},
            {"id": "c", "title": "C", "estimatedMinutes": "2.5h"},
        ]
    )
    result = validate_plan(doc)
    assert result.ok, messages(result)
    assert [n.estimated_minutes for n in result.plan.nodes] == [90, 45, 150]


def test_missing_required_fields_have_readable_messages():
    result = validate_plan({"schemaVersion": 1, "nodes": [{"id": "a"}]})
    msgs = messages(result)
    assert any(m == "Required field 'title' is missing." for m in msgs)
    assert any("node 'a': Required field 'title' is missing." == m for m in msgs)


def test_unknown_fields_warn_with_suggestion():
    doc = base_plan(nodes=[{"id": "a", "title": "A", "estimatedMinutes": 10, "prerequisits": []}])
    result = validate_plan(doc)
    assert result.ok
    assert any(
        "Unknown field 'prerequisits'" in m and "Did you mean 'prerequisites'?" in m
        for m in messages(result)
    )


def test_non_object_input():
    assert not validate_plan([1, 2, 3]).ok
    assert not validate_plan("nope").ok


def test_invalid_slug_ids_are_fixed_and_references_updated():
    doc = base_plan(
        nodes=[
            {"id": "Complex Numbers", "title": "CN", "estimatedMinutes": 10},
            {
                "id": "b",
                "title": "B",
                "estimatedMinutes": 10,
                "prerequisites": ["Complex Numbers"],
                "parent": "Complex Numbers",
            },
        ]
    )
    result = validate_plan(doc)
    assert result.ok, messages(result)
    assert result.plan.nodes[0].id == "complex-numbers"
    assert result.plan.nodes[1].prerequisites[0].id == "complex-numbers"
    assert result.plan.nodes[1].parent == "complex-numbers"


@pytest.mark.parametrize("key", ["progress", "notes"])
def test_progress_and_notes_for_unknown_nodes_only_warn(key):
    extra = {"zzz": {"status": "understood"}} if key == "progress" else {"zzz": "hello"}
    result = validate_plan(base_plan(**{key: extra}))
    assert result.ok
    assert any("unknown node 'zzz'" in m for m in messages(result))


def test_json_schema_is_generated_with_camel_case():
    schema = plan_json_schema()
    assert schema["title"] == "LearningPlan"
    assert "schemaVersion" in schema["properties"]
    node_props = schema["$defs"]["NodeSpec"]["properties"]
    assert "estimatedMinutes" in node_props and "prerequisites" in node_props
