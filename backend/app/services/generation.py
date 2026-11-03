"""Small Claude helpers with structured output: flashcards from a topic, variations of an exercise.

Shares the request path of the PDF extractor (JSON-schema output, pydantic validation), but the
network call is isolated in `structured_call` so tests can replace it.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import get_settings
from app.models.exercise import Exercise
from app.models.plan import PlanNode
from app.services.extraction import MAX_OUTPUT_TOKENS, Usage, _inline_refs, _strictify


class Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class CardOut(Strict):
    front: str = Field(description="Question or prompt, Markdown + LaTeX ($...$).")
    back: str = Field(description="Precise answer, Markdown + LaTeX. One fact per card.")


class CardsOut(Strict):
    cards: list[CardOut]


class PartOut(Strict):
    label: str
    statement: str
    solution: str | None = None


class VariationOut(Strict):
    title: str
    statement: str
    parts: list[PartOut] = []
    hints: list[str] = []
    solution: str | None = None
    difficulty: int | None = None


StructuredCaller = Callable[..., Awaitable[tuple[dict[str, Any], Usage]]]


def schema_for(model: type[BaseModel]) -> dict[str, Any]:
    return _strictify(_inline_refs(model.model_json_schema()))


async def structured_call(
    *, system: str, user: str, schema: dict[str, Any]
) -> tuple[dict[str, Any], Usage]:
    import anthropic

    settings = get_settings()
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured.")
    client = anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key, max_retries=2, timeout=300
    )
    response = await client.messages.create(
        model=settings.anthropic_model,
        max_tokens=min(MAX_OUTPUT_TOKENS, 8000),
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": schema}},
    )
    usage = Usage(
        getattr(response.usage, "input_tokens", 0) or 0,
        getattr(response.usage, "output_tokens", 0) or 0,
    )
    text = "".join(
        getattr(b, "text", "") for b in response.content if getattr(b, "type", None) == "text"
    )
    return json.loads(text), usage


CARDS_SYSTEM = """You write flashcards for spaced repetition (FSRS) for a university student in medical engineering. Each card tests exactly one fact, definition, formula, condition or procedure step. Fronts are short questions or cloze-like prompts; backs are precise and complete but minimal. Use Markdown with LaTeX ($...$ inline, $$...$$ display) for all mathematics. Keep the language of the source material. Do not repeat cards that already exist. Answer only with the JSON document."""


def cards_prompt(node: PlanNode, count: int, existing: list[str], note: str | None) -> str:
    parts = [
        f"Topic: {node.title}",
        f"Description:\n{node.description or '(none)'}",
        "Learning objectives:\n"
        + ("\n".join(f"- {o}" for o in node.objectives) if node.objectives else "(none)"),
    ]
    if node.keywords:
        parts.append("Keywords: " + ", ".join(node.keywords))
    if note and note.strip():
        parts.append(f"The student's own notes:\n{note[:4000]}")
    if existing:
        parts.append(
            "Existing cards (do not duplicate):\n" + "\n".join(f"- {e}" for e in existing[:40])
        )
    parts.append(f"Create {count} new flashcards.")
    return "\n\n".join(parts)


async def generate_cards(
    node: PlanNode,
    count: int,
    existing: list[str],
    note: str | None,
    caller: StructuredCaller | None = None,
) -> tuple[list[CardOut], Usage]:
    caller = caller or structured_call
    raw, usage = await caller(
        system=CARDS_SYSTEM,
        user=cards_prompt(node, count, existing, note),
        schema=schema_for(CardsOut),
    )
    cards = CardsOut.model_validate(raw).cards
    return [c for c in cards if c.front and c.back][:count], usage


VARIATION_SYSTEM = """You create practice variations of university exercises (mathematics, electrical engineering, signal processing, medical imaging, physics, programming). A variation tests the same concepts and methods as the original but changes the numbers, the concrete objects or the framing, so that the student cannot reuse the answer. Keep the same structure (sub-parts), difficulty and language. All mathematics in LaTeX ($...$ inline, $$...$$ display). Always provide a correct, worked solution for every part; double-check the arithmetic. Answer only with the JSON document."""


def variation_prompt(ex: Exercise) -> str:
    parts = "\n".join(
        f"{p.label}) {p.statement}" + (f"\n   Solution: {p.solution}" if p.solution else "")
        for p in ex.parts
    )
    return (
        f"Original exercise{f' ({ex.number})' if ex.number else ''}: {ex.title}\n\n{ex.statement}\n\n{parts}\n\n"
        + (f"Solution: {ex.solution}\n\n" if ex.solution else "")
        + (f"Hints: {'; '.join(ex.hints)}\n\n" if ex.hints else "")
        + f"Difficulty: {ex.difficulty or 'unknown'} / 5\n\nCreate one variation."
    )


async def generate_variation(
    ex: Exercise, caller: StructuredCaller | None = None
) -> tuple[VariationOut, Usage]:
    caller = caller or structured_call
    raw, usage = await caller(
        system=VARIATION_SYSTEM, user=variation_prompt(ex), schema=schema_for(VariationOut)
    )
    return VariationOut.model_validate(raw), usage
