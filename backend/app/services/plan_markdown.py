"""Fallback importer: turn a Markdown outline into a raw plan document.

Headings mode (used when the text contains `##`+ headings):
    # Plan title            -> plan title, following paragraph -> description
    ## Topic / ### Subtopic -> nodes, nesting follows heading depth
Bullet mode (no `##` headings):
    - Topic                 -> node, nested bullets -> child nodes

Inside a node, `key: value` lines (optionally as bullets) set attributes:
    prerequisites|requires|prereq|voraussetzungen: a, b
    time|estimated|duration|zeit: 90 min | 1.5h
    difficulty|schwierigkeit: 3
    objectives|ziele: inline, comma separated  (or nested "- ..." bullets on following lines)
    keywords|tags: a, b
    id: custom-slug
Plan-level lines `exam: 2026-02-05`, `subject: ...`, `language: de` are recognised too.
Everything else becomes the node description. Title-based prerequisite references are resolved by the validator.
"""

from __future__ import annotations

import re
from typing import Any

_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_BULLET = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_KV = re.compile(r"^\s*(?:[-*+]\s+)?\**([A-Za-zäöüÄÖÜ ]{2,24})\**\s*:\s*(.*)$")

_NODE_KEYS = {
    "prerequisites": "prerequisites",
    "prerequisite": "prerequisites",
    "requires": "prerequisites",
    "prereq": "prerequisites",
    "prereqs": "prerequisites",
    "voraussetzungen": "prerequisites",
    "voraussetzung": "prerequisites",
    "time": "estimatedMinutes",
    "estimated": "estimatedMinutes",
    "estimate": "estimatedMinutes",
    "duration": "estimatedMinutes",
    "zeit": "estimatedMinutes",
    "dauer": "estimatedMinutes",
    "difficulty": "difficulty",
    "schwierigkeit": "difficulty",
    "objectives": "objectives",
    "objective": "objectives",
    "goals": "objectives",
    "ziele": "objectives",
    "lernziele": "objectives",
    "keywords": "keywords",
    "tags": "keywords",
    "stichworte": "keywords",
    "id": "id",
}
_PLAN_KEYS = {
    "exam": "exam",
    "prüfung": "exam",
    "klausur": "exam",
    "subject": "subject",
    "fach": "subject",
    "language": "language",
    "sprache": "language",
    "id": "id",
    "tags": "tags",
}
_LIST_KEYS = {"prerequisites", "objectives", "keywords", "tags"}


def looks_like_markdown(text: str) -> bool:
    stripped = text.lstrip()
    if stripped.startswith("{"):
        return False
    return bool(re.search(r"^\s*(#{1,6}\s|[-*+]\s)", text, re.MULTILINE))


def _split_list(value: str) -> list[str]:
    return [v.strip().strip("`'\"") for v in re.split(r"[,;]", value) if v.strip()]


def _apply_kv(target: dict[str, Any], canonical: str, value: str) -> None:
    value = value.strip()
    if canonical in _LIST_KEYS:
        target.setdefault(canonical, [])
        if value:
            target[canonical].extend(_split_list(value))
    elif canonical == "difficulty":
        m = re.search(r"\d", value)
        if m:
            target["difficulty"] = int(m.group(0))
    elif canonical == "exam":
        m = re.search(r"\d{4}-\d{2}-\d{2}", value)
        if m:
            target["exam"] = {
                "date": m.group(0),
                "name": value.replace(m.group(0), "").strip(" ,()-") or None,
            }
    else:
        target[canonical] = value


class _NodeBuilder:
    def __init__(self, title: str, depth: int) -> None:
        self.data: dict[str, Any] = {"title": title.strip()}
        self.depth = depth
        self.body: list[str] = []
        self.pending_list_key: str | None = None

    def feed(self, line: str) -> None:
        bullet = _BULLET.match(line)
        if self.pending_list_key and bullet and len(bullet.group(1)) >= 2:
            self.data.setdefault(self.pending_list_key, []).append(bullet.group(2).strip())
            return
        kv = _KV.match(line)
        if kv and kv.group(1).strip().lower() in _NODE_KEYS:
            canonical = _NODE_KEYS[kv.group(1).strip().lower()]
            _apply_kv(self.data, canonical, kv.group(2))
            self.pending_list_key = (
                canonical if canonical in _LIST_KEYS and not kv.group(2).strip() else None
            )
            return
        self.pending_list_key = None
        self.body.append(line.rstrip())

    def finish(self) -> dict[str, Any]:
        description = "\n".join(self.body).strip()
        if description:
            self.data["description"] = description
        return self.data


def _parse_headings(lines: list[str]) -> dict[str, Any]:
    plan: dict[str, Any] = {"nodes": []}
    plan_body: list[str] = []
    stack: list[_NodeBuilder] = []  # open nodes by depth
    builders: list[_NodeBuilder] = []

    def close_to(depth: int) -> None:
        while stack and stack[-1].depth >= depth:
            stack.pop()

    for line in lines:
        heading = _HEADING.match(line)
        if heading:
            level, text = len(heading.group(1)), heading.group(2)
            if level == 1 and "title" not in plan:
                plan["title"] = text
                continue
            depth = max(level - 2, 0) if "title" in plan else max(level - 1, 0)
            close_to(depth)
            builder = _NodeBuilder(text, depth)
            if stack:
                builder.data["parent"] = stack[-1]
            stack.append(builder)
            builders.append(builder)
            continue
        if stack:
            stack[-1].feed(line)
        else:
            kv = _KV.match(line)
            if kv and kv.group(1).strip().lower() in _PLAN_KEYS:
                _apply_kv(plan, _PLAN_KEYS[kv.group(1).strip().lower()], kv.group(2))
            else:
                plan_body.append(line.rstrip())

    description = "\n".join(plan_body).strip()
    if description:
        plan["description"] = description
    _finalize(plan, builders)
    return plan


def _parse_bullets(lines: list[str]) -> dict[str, Any]:
    plan: dict[str, Any] = {"nodes": []}
    builders: list[_NodeBuilder] = []
    stack: list[tuple[int, _NodeBuilder]] = []
    for line in lines:
        heading = _HEADING.match(line)
        if heading and "title" not in plan:
            plan["title"] = heading.group(2)
            continue
        bullet = _BULLET.match(line)
        if bullet:
            indent, text = len(bullet.group(1).expandtabs(4)), bullet.group(2).strip()
            kv = _KV.match(text)
            if kv and kv.group(1).strip().lower() in _NODE_KEYS and stack and indent > stack[-1][0]:
                stack[-1][1].feed(line)
                continue
            while stack and stack[-1][0] >= indent:
                stack.pop()
            builder = _NodeBuilder(text, len(stack))
            if stack:
                builder.data["parent"] = stack[-1][1]
            stack.append((indent, builder))
            builders.append(builder)
            continue
        if stack:
            stack[-1][1].feed(line)
        else:
            kv = _KV.match(line)
            if kv and kv.group(1).strip().lower() in _PLAN_KEYS:
                _apply_kv(plan, _PLAN_KEYS[kv.group(1).strip().lower()], kv.group(2))
            elif line.strip():
                plan.setdefault("_body", []).append(line.rstrip())
    body = plan.pop("_body", [])
    if body:
        plan["description"] = "\n".join(body).strip()
    _finalize(plan, builders)
    return plan


def _finalize(plan: dict[str, Any], builders: list[_NodeBuilder]) -> None:
    from app.core.text import slugify, unique_slug

    taken: set[str] = set()
    for b in builders:
        explicit = b.data.get("id")
        base = (
            slugify(explicit)
            if isinstance(explicit, str) and explicit
            else slugify(b.data["title"])
        )
        b.data["id"] = unique_slug(base, taken)
        taken.add(b.data["id"])
    for b in builders:
        parent = b.data.get("parent")
        if isinstance(parent, _NodeBuilder):
            b.data["parent"] = parent.data["id"]
        plan["nodes"].append(b.finish())
    plan.setdefault("title", plan["nodes"][0]["title"] if plan["nodes"] else "Untitled plan")
    plan.setdefault("schemaVersion", 1)


def markdown_to_plan(text: str) -> dict[str, Any]:
    lines = text.replace("\r\n", "\n").split("\n")
    has_sub_headings = any((m := _HEADING.match(ln)) and len(m.group(1)) >= 2 for ln in lines)
    return _parse_headings(lines) if has_sub_headings else _parse_bullets(lines)
