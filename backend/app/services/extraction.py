"""PDF -> exercises with Claude.

Pipeline (per job): plan page chunks -> for each chunk build a request (sub-PDF document block, or
page images for scanned PDFs) -> force the `record_exercises` tool so the answer is strict JSON ->
validate with pydantic (one retry with the error fed back) -> stitch exercises that cross chunk
boundaries -> crop figures from the rendered pages -> drafts for the review screen.

The network call is isolated in `call_model` so tests can replace it.
"""

from __future__ import annotations

import base64
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.services import pdf as pdfsvc

TOOL_NAME = "record_exercises"
MAX_OUTPUT_TOKENS = 24000

# ----------------------------------------------------------------------------- model output schema


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class FigureOut(StrictModel):
    page: int = Field(description="Absolute 1-based page number where the figure is printed.")
    bbox: list[float] = Field(
        description="Bounding box [x0, y0, x1, y1] in normalised page coordinates (0-1, origin top-left), including the caption. Be generous (add ~2% margin)."
    )
    caption: str = Field(
        "", description="Short caption or what the figure shows, e.g. 'Circuit with two resistors'."
    )
    part_label: str | None = Field(
        None, description="Sub-part label this figure belongs to, if any."
    )

    @field_validator("bbox")
    @classmethod
    def _four(cls, v: list[float]) -> list[float]:
        if len(v) != 4:
            raise ValueError("bbox must contain exactly 4 numbers [x0, y0, x1, y1]")
        return [min(1.0, max(0.0, float(x))) for x in v]


class PartOut(StrictModel):
    label: str = Field(description="Sub-part label as printed: 'a', 'b', 'i', 'ii', '1', ...")
    statement: str = Field(description="Task text of this sub-part, Markdown + LaTeX.")
    hints: list[str] = Field(
        default_factory=list,
        description="Hints printed in the source for this part (never invented).",
    )
    solution: str | None = Field(
        None,
        description="Solution/answer printed in the source for this part, Markdown + LaTeX. Omit if none.",
    )


class ExerciseOut(StrictModel):
    number: str | None = Field(
        None, description="Exercise number as printed, e.g. '3', '2.4', 'Aufgabe 7'."
    )
    title: str | None = Field(None, description="Short title (printed or a 3-6 word summary).")
    statement: str = Field(
        "",
        description="Main task text shared by all parts (introduction, given data). Markdown + LaTeX. Empty if everything is in parts.",
    )
    parts: list[PartOut] = Field(default_factory=list)
    hints: list[str] = Field(
        default_factory=list, description="Hints printed for the whole exercise."
    )
    solution: str | None = Field(
        None, description="Solution printed for the whole exercise (when not split per part)."
    )
    difficulty: int | None = Field(
        None, ge=1, le=5, description="Estimated difficulty 1 (routine) to 5 (very hard)."
    )
    page_from: int = Field(description="Absolute 1-based page where the exercise starts.")
    page_to: int = Field(description="Absolute 1-based page where the exercise ends.")
    figures: list[FigureOut] = Field(
        default_factory=list,
        description="Figures, diagrams, circuits, plots or image-tables belonging to this exercise.",
    )
    suggested_node_ids: list[int] = Field(
        default_factory=list,
        description="0-3 ids from the provided topic list that this exercise practises.",
    )
    continues_from_previous: bool = Field(
        False, description="True if this exercise started before the first page of this excerpt."
    )
    continues_on_next: bool = Field(
        False,
        description="True if this exercise clearly continues after the last page of this excerpt.",
    )


class ChunkOut(StrictModel):
    exercises: list[ExerciseOut] = Field(default_factory=list)
    notes: list[str] = Field(
        default_factory=list,
        description="Short remarks for the reviewer, e.g. 'Solutions for sheet 3 start on page 9'.",
    )


def _inline_refs(schema: dict[str, Any]) -> dict[str, Any]:
    """Resolve local $refs so the tool schema has no $defs (keeps every API happy)."""
    defs = schema.pop("$defs", {})

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].split("/")[-1]
                return walk(defs[name])
            return {k: walk(v) for k, v in node.items() if k != "title"}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    return walk(schema)


def tool_schema() -> dict[str, Any]:
    return _inline_refs(ChunkOut.model_json_schema())


# ----------------------------------------------------------------------------- prompt


SYSTEM_PROMPT = """You extract exercises from university course material (exercise sheets, problem collections, past exams) in mathematics, electrical engineering, signal processing, medical imaging, physics and programming. You always answer by calling the `record_exercises` tool exactly once.

Rules:
1. One entry per exercise. Numbered problems ("Aufgabe 3", "Exercise 2.4", "Problem 7", "Beispiel 12") are exercises; their sub-questions (a), (b), i), ii), 1., 2. become `parts`. Keep the printed numbering in `number` and part `label`.
2. Reproduce statements faithfully and completely, in the original language. Convert ALL mathematics to LaTeX: `$...$` inline, `$$...$$` for displayed equations. Keep given values, units, vectors, matrices (use `\\begin{pmatrix}`), and tables (as Markdown tables). Do not paraphrase or shorten.
3. Solutions: if the material contains solutions or final answers (a solutions section, "Lösung", "Answer", inline results), copy them into `solution` of the matching exercise or part. Never invent solutions or hints. If a separate solutions section appears later in the excerpt, match it to the exercises by number.
4. Figures: for every drawing, circuit diagram, plot, geometric sketch, screenshot or image-only table that belongs to an exercise, add a `figures` entry with the absolute page number and the bounding box in normalised page coordinates (x0, y0, x1, y1 between 0 and 1, origin at the top-left corner, x to the right, y downwards). Include the figure caption and leave ~2% margin. Do not add figures for plain text.
5. Page numbers (`page_from`, `page_to`, figure `page`) are ABSOLUTE page numbers of the full document; the excerpt tells you which absolute pages it contains.
6. If the excerpt begins in the middle of an exercise, still record the visible remainder and set `continues_from_previous` = true on it. If the last exercise obviously continues beyond the excerpt (unfinished sentence, "continued on next page"), set `continues_on_next` = true.
7. Suggest 0-3 matching topic ids from the provided topic list in `suggested_node_ids`; use only ids from that list.
8. Estimate `difficulty` 1-5 relative to a bachelor-level exam.
9. Ignore page headers/footers, course logos, submission instructions and grading remarks. Record general remarks for the reviewer in `notes` (e.g. where solutions were found, illegible parts).
10. If the excerpt contains no exercises, return an empty list."""


def build_user_prompt(
    filename: str,
    total_pages: int,
    page_from: int,
    page_to: int,
    topics: list[dict[str, Any]],
    as_images: bool,
) -> str:
    what = (
        f"The attached images are pages {page_from} to {page_to} (one image per page, in order)"
        if as_images
        else f"The attached PDF contains pages {page_from} to {page_to}"
    )
    topic_lines = "\n".join(
        f"- id {t['id']}: {t['title']}"
        + (f" ({', '.join(t['keywords'][:6])})" if t.get("keywords") else "")
        for t in topics[:200]
    )
    topics_block = (
        f"Topic list for `suggested_node_ids`:\n{topic_lines}"
        if topic_lines
        else "No topic list is available; leave `suggested_node_ids` empty."
    )
    return (
        f"{what} of the document '{filename}' ({total_pages} pages in total). "
        f"Page numbers in your output must be absolute (first attached page = {page_from}).\n\n"
        f"{topics_block}\n\nExtract every exercise now."
    )


# ----------------------------------------------------------------------------- model call


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0

    def add(self, other: Usage) -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens


ModelCaller = Callable[..., Awaitable[tuple[dict[str, Any], Usage]]]


async def call_model(
    *, model: str, system: str, content: list[dict[str, Any]], api_key: str | None
) -> tuple[dict[str, Any], Usage]:
    """Send one request to Claude and return the tool input (raw dict) + token usage."""
    import anthropic

    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured.")
    client = anthropic.AsyncAnthropic(api_key=api_key, max_retries=3, timeout=900)
    response = await client.messages.create(
        model=model,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=system,
        messages=[{"role": "user", "content": content}],
        tools=[
            {
                "name": TOOL_NAME,
                "description": "Record the exercises found in the attached pages.",
                "input_schema": tool_schema(),
            }
        ],
        tool_choice={"type": "tool", "name": TOOL_NAME},
    )
    usage = Usage(
        getattr(response.usage, "input_tokens", 0) or 0,
        getattr(response.usage, "output_tokens", 0) or 0,
    )
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == TOOL_NAME:
            return dict(block.input), usage
    raise RuntimeError("The model did not call the record_exercises tool.")


def document_block(pdf_bytes: bytes) -> dict[str, Any]:
    return {
        "type": "document",
        "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": base64.b64encode(pdf_bytes).decode(),
        },
    }


def image_block(jpeg_bytes: bytes) -> dict[str, Any]:
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": base64.b64encode(jpeg_bytes).decode(),
        },
    }


# ----------------------------------------------------------------------------- chunking


def plan_chunks(page_from: int, page_to: int, size: int) -> list[tuple[int, int]]:
    size = max(1, size)
    chunks = []
    start = page_from
    while start <= page_to:
        end = min(start + size - 1, page_to)
        # avoid a tiny trailing chunk: fold a 1-page remainder into the previous chunk
        if end < page_to and page_to - end == 1:
            end = page_to
        chunks.append((start, end))
        start = end + 1
    return chunks


def parse_chunk(raw: dict[str, Any]) -> ChunkOut:
    return ChunkOut.model_validate(raw)


def validation_feedback(exc: ValidationError) -> str:
    lines = [f"- {'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:12]]
    return (
        "Your previous tool call did not match the schema. Problems:\n"
        + "\n".join(lines)
        + "\nCall the tool again with corrected data for the same pages."
    )


async def extract_chunk(
    *,
    caller: ModelCaller,
    model: str,
    api_key: str | None,
    content: list[dict[str, Any]],
    page_from: int,
    page_to: int,
    allowed_node_ids: set[int],
) -> tuple[ChunkOut, Usage]:
    usage = Usage()
    raw, u = await caller(model=model, system=SYSTEM_PROMPT, content=content, api_key=api_key)
    usage.add(u)
    try:
        chunk = parse_chunk(raw)
    except ValidationError as exc:
        retry_content = content + [
            {
                "type": "text",
                "text": validation_feedback(exc)
                + f"\n\nYour previous output was:\n{json.dumps(raw)[:6000]}",
            }
        ]
        raw, u = await caller(
            model=model, system=SYSTEM_PROMPT, content=retry_content, api_key=api_key
        )
        usage.add(u)
        chunk = parse_chunk(raw)  # second failure propagates
    for ex in chunk.exercises:
        ex.page_from = min(max(ex.page_from, page_from), page_to)
        ex.page_to = min(max(ex.page_to, ex.page_from), page_to)
        ex.suggested_node_ids = [
            i for i in dict.fromkeys(ex.suggested_node_ids) if i in allowed_node_ids
        ][:3]
        ex.figures = [f for f in ex.figures if page_from <= f.page <= page_to]
    return chunk, usage


# ----------------------------------------------------------------------------- stitching


def _merge_into(first: ExerciseOut, second: ExerciseOut) -> ExerciseOut:
    labels = {p.label for p in first.parts}
    merged_parts = list(first.parts)
    for p in second.parts:
        if p.label in labels:
            existing = next(mp for mp in merged_parts if mp.label == p.label)
            existing.statement = (existing.statement + "\n\n" + p.statement).strip()
            existing.hints += p.hints
            existing.solution = existing.solution or p.solution
        else:
            merged_parts.append(p)
    return ExerciseOut(
        number=first.number or second.number,
        title=first.title or second.title,
        statement=(
            first.statement + ("\n\n" + second.statement if second.statement else "")
        ).strip(),
        parts=merged_parts,
        hints=first.hints + second.hints,
        solution=first.solution or second.solution,
        difficulty=first.difficulty or second.difficulty,
        page_from=first.page_from,
        page_to=max(first.page_to, second.page_to),
        figures=first.figures + second.figures,
        suggested_node_ids=list(
            dict.fromkeys(first.suggested_node_ids + second.suggested_node_ids)
        )[:3],
        continues_from_previous=first.continues_from_previous,
        continues_on_next=second.continues_on_next,
    )


def stitch(chunks: list[ChunkOut]) -> list[ExerciseOut]:
    """Concatenate chunk results, merging an exercise split across a chunk boundary."""
    out: list[ExerciseOut] = []
    for chunk in chunks:
        for i, ex in enumerate(chunk.exercises):
            if (
                i == 0
                and out
                and (ex.continues_from_previous or out[-1].continues_on_next)
                and (ex.number is None or out[-1].number is None or ex.number == out[-1].number)
            ):
                out[-1] = _merge_into(out[-1], ex)
            else:
                out.append(ex.model_copy(deep=True))
    for ex in out:
        ex.continues_from_previous = False
        ex.continues_on_next = False
    return out


# ----------------------------------------------------------------------------- drafts


@dataclass
class DraftBuild:
    drafts: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _new_id() -> str:
    return uuid.uuid4().hex[:10]


def build_drafts(exercises: list[ExerciseOut], doc_id: int, pdf_path: Path) -> DraftBuild:
    """Turn model output into review drafts; crop figures into real image files."""
    result = DraftBuild()
    for ex in exercises:
        figures = []
        for fig in ex.figures:
            try:
                rel, bbox = pdfsvc.crop_figure(doc_id, pdf_path, fig.page, fig.bbox)
            except Exception as exc:  # noqa: BLE001 - a bad bbox must not kill the job
                result.warnings.append(
                    f"Could not crop figure on page {fig.page} for exercise {ex.number or ex.title or '?'}: {exc}"
                )
                continue
            figures.append(
                {
                    "id": _new_id(),
                    "page": fig.page,
                    "bbox": list(bbox),
                    "caption": fig.caption,
                    "part_label": fig.part_label,
                    "path": rel,
                }
            )
        result.drafts.append(
            {
                "id": _new_id(),
                "number": ex.number,
                "title": ex.title or (f"Exercise {ex.number}" if ex.number else ""),
                "statement": ex.statement,
                "parts": [
                    {
                        "id": _new_id(),
                        "label": p.label,
                        "statement": p.statement,
                        "hints": p.hints,
                        "solution": p.solution,
                    }
                    for p in ex.parts
                ],
                "hints": ex.hints,
                "solution": ex.solution,
                "difficulty": ex.difficulty,
                "page_from": ex.page_from,
                "page_to": ex.page_to,
                "figures": figures,
                "node_ids": ex.suggested_node_ids,
                "suggested_node_ids": ex.suggested_node_ids,
            }
        )
    return result


# ----------------------------------------------------------------------------- pricing

# USD per million tokens (input, output); prefix-matched against the model id.
PRICING: dict[str, tuple[float, float]] = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-opus-4": (15.0, 75.0),
    "claude-sonnet-4": (3.0, 15.0),
    "claude-haiku-4": (1.0, 5.0),
}


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float | None:
    for prefix, (pin, pout) in PRICING.items():
        if model.startswith(prefix):
            return round((input_tokens * pin + output_tokens * pout) / 1_000_000, 4)
    return None
