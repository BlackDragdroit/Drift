import asyncio
import json

import pytest
from pydantic import ValidationError

from app.services import extraction
from app.services.extraction import (
    ChunkOut,
    Usage,
    build_drafts,
    parse_chunk,
    plan_chunks,
    stitch,
    tool_schema,
)
from tests.conftest import load_fixture
from tests.pdf_fixtures import make_text_pdf


def chunk(name: str) -> ChunkOut:
    return parse_chunk(json.loads(load_fixture(name)))


def test_plan_chunks_folds_tiny_remainder():
    assert plan_chunks(1, 20, 8) == [(1, 8), (9, 16), (17, 20)]
    assert plan_chunks(1, 9, 8) == [(1, 9)]
    assert plan_chunks(3, 3, 8) == [(3, 3)]
    assert plan_chunks(1, 17, 8) == [(1, 8), (9, 17)]


def test_tool_schema_has_no_refs():
    schema = tool_schema()
    assert "$defs" not in schema
    assert json.dumps(schema).count("$ref") == 0
    assert (
        schema["properties"]["exercises"]["items"]["properties"]["page_from"]["type"] == "integer"
    )
    # a *property* named "title" must survive the removal of schema `title` metadata
    exercise = schema["properties"]["exercises"]["items"]
    assert "title" in exercise["properties"] and "title" in exercise["required"]
    assert "title" not in schema and "title" not in exercise


def test_parse_chunk_validates_and_clamps_bbox():
    c = chunk("extraction_chunk_1.json")
    assert [e.number for e in c.exercises] == ["1", "2"]
    assert c.exercises[0].parts[1].solution == "A trapezoid."
    bad = {
        "exercises": [
            {
                "number": "1",
                "page_from": 1,
                "page_to": 1,
                "figures": [{"page": 1, "bbox": [0.1, 0.2]}],
            }
        ]
    }
    with pytest.raises(ValidationError):
        parse_chunk(bad)
    clamped = parse_chunk(
        {
            "exercises": [
                {"page_from": 1, "page_to": 1, "figures": [{"page": 1, "bbox": [-1, 0.2, 2, 0.4]}]}
            ]
        }
    )
    assert clamped.exercises[0].figures[0].bbox == [0.0, 0.2, 1.0, 0.4]


def test_stitch_merges_exercise_across_chunk_boundary():
    merged = stitch([chunk("extraction_chunk_1.json"), chunk("extraction_chunk_2.json")])
    assert [e.number for e in merged] == ["1", "2", "3"]
    two = merged[1]
    assert [p.label for p in two.parts] == ["a", "b"]
    assert two.page_from == 2 and two.page_to == 3
    assert two.statement.startswith("An LTI system")
    assert not two.continues_on_next and not two.continues_from_previous


def test_stitch_does_not_merge_when_numbers_differ():
    a = chunk("extraction_chunk_1.json")
    b = chunk("extraction_chunk_2.json")
    b.exercises[0].number = "7"
    merged = stitch([a, b])
    assert [e.number for e in merged] == ["1", "2", "7", "3"]


def test_extract_chunk_retries_once_with_feedback_and_filters_output():
    calls = []

    async def fake_caller(*, model, system, content, api_key):
        calls.append(content)
        if len(calls) == 1:
            return {"exercises": [{"number": "1"}]}, Usage(
                100, 10
            )  # missing page_from/page_to -> invalid
        return json.loads(load_fixture("extraction_chunk_1.json")), Usage(120, 50)

    result, usage = asyncio.run(
        extraction.extract_chunk(
            caller=fake_caller,
            model="m",
            api_key="k",
            content=[{"type": "text", "text": "x"}],
            page_from=1,
            page_to=2,
            allowed_node_ids={1, 2},
        )
    )
    assert len(calls) == 2
    assert "did not match the schema" in calls[1][-1]["text"]
    assert usage.input_tokens == 220 and usage.output_tokens == 60
    assert result.exercises[0].suggested_node_ids == [1]  # 999 is not allowed
    assert result.exercises[1].page_to == 2  # clamped to the chunk


def test_extract_chunk_gives_up_after_second_failure():
    async def always_bad(*, model, system, content, api_key):
        return {"exercises": "nope"}, Usage()

    with pytest.raises(ValidationError):
        asyncio.run(
            extraction.extract_chunk(
                caller=always_bad,
                model="m",
                api_key="k",
                content=[],
                page_from=1,
                page_to=1,
                allowed_node_ids=set(),
            )
        )


def test_build_drafts_crops_figures_and_reports_bad_ones(tmp_path):
    pdf = make_text_pdf(tmp_path / "sheet.pdf", pages=3)
    exercises = stitch([chunk("extraction_chunk_1.json"), chunk("extraction_chunk_2.json")])
    built = build_drafts(exercises, doc_id=5, pdf_path=pdf)
    assert len(built.drafts) == 3
    first = built.drafts[0]
    assert (
        first["figures"][0]["path"].startswith("figures/5/")
        and first["figures"][0]["caption"] == "Figure 1: a blue box"
    )
    assert first["node_ids"] == [1, 999] and first["parts"][1]["solution"] == "A trapezoid."
    assert built.drafts[2]["figures"] == []  # page 9 does not exist in a 3-page PDF
    assert any("page 9" in w for w in built.warnings)


def test_cost_estimate():
    assert extraction.estimate_cost_usd("claude-sonnet-5-5", 1_000_000, 100_000) == 3.0
    assert extraction.estimate_cost_usd("unknown-model", 10, 10) is None


def test_user_prompt_mentions_pages_and_topics():
    text = extraction.build_user_prompt(
        "sheet.pdf",
        12,
        5,
        8,
        [{"id": 3, "title": "Convolution", "keywords": ["lti"]}],
        as_images=False,
    )
    assert (
        "pages 5 to 8" in text
        and "first attached page = 5" in text
        and "id 3: Convolution (lti)" in text
    )
    assert "one image per page" in extraction.build_user_prompt(
        "s.pdf", 2, 1, 2, [], as_images=True
    )
