"""Forgiving normalization + strict validation of learning plan documents.

Pipeline: raw dict -> normalize (fill ids, flatten children, default version)
-> pydantic PlanSpec -> semantic checks (references, cycles) -> ValidationResult.
Every problem is reported as an Issue with a JSON-path-like location and a plain-English message.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import ValidationError

from app.core.text import SLUG_RE, slugify, unique_slug
from app.schemas.plan_format import (
    SCHEMA_VERSION,
    SUPPORTED_SCHEMA_VERSIONS,
    NodeSpec,
    PlanSpec,
)

Severity = Literal["error", "warning"]


@dataclass
class Issue:
    path: str
    message: str
    severity: Severity = "error"

    def as_dict(self) -> dict[str, str]:
        return {"path": self.path, "message": self.message, "severity": self.severity}


@dataclass
class ValidationResult:
    plan: PlanSpec | None
    issues: list[Issue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.plan is not None and not any(i.severity == "error" for i in self.issues)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "warning"]


_KNOWN_PLAN_KEYS = {f.alias or name for name, f in PlanSpec.model_fields.items()} | set(
    PlanSpec.model_fields
)
_KNOWN_NODE_KEYS = {f.alias or name for name, f in NodeSpec.model_fields.items()} | set(
    NodeSpec.model_fields
)


# --------------------------------------------------------------------------- normalization


def normalize(raw: Any, issues: list[Issue]) -> dict[str, Any]:
    """Make the document as valid as reasonably possible without changing its meaning.

    Returns a new dict; `issues` receives warnings about every automatic fix.
    """
    if not isinstance(raw, dict):
        issues.append(
            Issue("$", "The document must be a JSON object with at least 'title' and 'nodes'.")
        )
        return {}
    doc: dict[str, Any] = dict(raw)

    version = doc.get("schemaVersion", doc.get("schema_version"))
    if version is None:
        doc["schemaVersion"] = SCHEMA_VERSION
        issues.append(
            Issue(
                "$.schemaVersion", f"Missing schemaVersion; assuming {SCHEMA_VERSION}.", "warning"
            )
        )
    elif isinstance(version, str) and version.isdigit():
        doc["schemaVersion"] = int(version)
    if doc.get("schemaVersion") not in SUPPORTED_SCHEMA_VERSIONS:
        issues.append(
            Issue(
                "$.schemaVersion",
                f"Unsupported schemaVersion {doc.get('schemaVersion')!r}; supported: {list(SUPPORTED_SCHEMA_VERSIONS)}.",
            )
        )

    for key in doc:
        if key not in _KNOWN_PLAN_KEYS:
            suggestion = _suggest(key, _KNOWN_PLAN_KEYS)
            issues.append(
                Issue(f"$.{key}", f"Unknown field '{key}' is ignored.{suggestion}", "warning")
            )

    if "title" not in doc and isinstance(doc.get("name"), str):
        doc["title"] = doc.pop("name")
        issues.append(Issue("$.title", "Used 'name' as the plan title.", "warning"))

    plan_id = doc.get("id")
    if isinstance(plan_id, str) and plan_id and not SLUG_RE.match(plan_id):
        doc["id"] = slugify(plan_id)
        issues.append(
            Issue(
                "$.id", f"Plan id '{plan_id}' was not a valid slug; using '{doc['id']}'.", "warning"
            )
        )
    elif not plan_id and isinstance(doc.get("title"), str) and doc["title"].strip():
        doc["id"] = slugify(doc["title"])
        issues.append(
            Issue("$.id", f"Missing plan id; generated '{doc['id']}' from the title.", "warning")
        )

    nodes = doc.get("nodes")
    if isinstance(nodes, list):
        doc["nodes"] = _flatten_nodes(nodes, issues)
        _assign_node_ids(doc["nodes"], issues)
    return doc


def _flatten_nodes(nodes: list[Any], issues: list[Issue]) -> list[Any]:
    flat: list[Any] = []

    def visit(node: Any, parent_id: str | None, path: str) -> None:
        if not isinstance(node, dict):
            flat.append(node)
            return
        node = dict(node)
        children = node.pop("children", None)
        if parent_id is not None and not node.get("parent"):
            node["parent"] = parent_id
        flat.append(node)
        if children:
            if not isinstance(children, list):
                issues.append(Issue(f"{path}.children", "'children' must be a list; ignored."))
                return
            # Children need the parent's id; ensure it exists before descending.
            if not node.get("id"):
                node["id"] = slugify(str(node.get("title", "node")))
            for i, child in enumerate(children):
                visit(child, node["id"], f"{path}.children[{i}]")

    for i, node in enumerate(nodes):
        visit(node, None, f"$.nodes[{i}]")
    if len(flat) != len(nodes):
        issues.append(
            Issue("$.nodes", "Nested 'children' were flattened into the node list.", "warning")
        )
    return flat


def _assign_node_ids(nodes: list[Any], issues: list[Issue]) -> None:
    taken: set[str] = {
        n["id"] for n in nodes if isinstance(n, dict) and isinstance(n.get("id"), str) and n["id"]
    }
    renamed: dict[str, str] = {}
    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        for key in node:
            if key not in _KNOWN_NODE_KEYS:
                suggestion = _suggest(key, _KNOWN_NODE_KEYS)
                issues.append(
                    Issue(
                        f"$.nodes[{i}].{key}",
                        f"Unknown field '{key}' is ignored.{suggestion}",
                        "warning",
                    )
                )
        node_id = node.get("id")
        if isinstance(node_id, str) and node_id and SLUG_RE.match(node_id):
            continue
        title = node.get("title")
        base = slugify(
            node_id if isinstance(node_id, str) and node_id else str(title or f"node-{i + 1}")
        )
        new_id = unique_slug(base, taken)
        taken.add(new_id)
        if isinstance(node_id, str) and node_id:
            renamed[node_id] = new_id
            issues.append(
                Issue(
                    f"$.nodes[{i}].id",
                    f"Node id '{node_id}' was not a valid slug; using '{new_id}'.",
                    "warning",
                )
            )
        else:
            issues.append(
                Issue(
                    f"$.nodes[{i}].id",
                    f"Node {i + 1} ('{title}') had no id; generated '{new_id}'.",
                    "warning",
                )
            )
        node["id"] = new_id
    if renamed:
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if node.get("parent") in renamed:
                node["parent"] = renamed[node["parent"]]
            prereqs = node.get("prerequisites")
            if isinstance(prereqs, list):
                node["prerequisites"] = [
                    renamed.get(p, p)
                    if isinstance(p, str)
                    else (
                        {**p, "id": renamed.get(p.get("id"), p.get("id"))}
                        if isinstance(p, dict)
                        else p
                    )
                    for p in prereqs
                ]


# --------------------------------------------------------------------------- pydantic errors


def _format_loc(loc: tuple[Any, ...]) -> str:
    out = "$"
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else f".{part}"
    return out


def _pydantic_issues(exc: ValidationError, doc: dict[str, Any]) -> list[Issue]:
    issues: list[Issue] = []
    seen: set[tuple[str, str]] = set()
    for err in exc.errors():
        loc = err["loc"]
        # Union errors (str | Prerequisite) produce one entry per branch; collapse them.
        loc = tuple(
            p
            for p in loc
            if p
            not in (
                "str",
                "Prerequisite",
                "function-after[_normalize_prerequisites(), list[union[str,Prerequisite]]]",
            )
        )
        path = _format_loc(loc)
        msg = err["msg"]
        if err["type"] == "missing":
            msg = f"Required field '{loc[-1]}' is missing."
        elif err["type"] == "string_pattern_mismatch":
            msg = f"'{err.get('input')}' is not a valid slug (use lowercase letters, digits and hyphens, e.g. 'fourier-series')."
        elif err["type"] == "literal_error" and loc and loc[-1] == "schemaVersion":
            msg = f"Unsupported schemaVersion {err.get('input')!r}."
        elif err["type"] == "too_short" and loc and loc[-1] == "nodes":
            msg = "A plan needs at least one node."
        context = _node_context(loc, doc)
        if (path, msg) in seen:
            continue
        seen.add((path, msg))
        issues.append(Issue(path, f"{context}{msg}"))
    return issues


def _node_context(loc: tuple[Any, ...], doc: dict[str, Any]) -> str:
    if len(loc) >= 2 and loc[0] == "nodes" and isinstance(loc[1], int):
        nodes = doc.get("nodes") or []
        if loc[1] < len(nodes) and isinstance(nodes[loc[1]], dict):
            node = nodes[loc[1]]
            label = node.get("id") or node.get("title") or f"#{loc[1] + 1}"
            return f"node '{label}': "
    return ""


# --------------------------------------------------------------------------- semantic checks


def _suggest(value: str, candidates: set[str] | list[str]) -> str:
    matches = difflib.get_close_matches(value, list(candidates), n=1, cutoff=0.6)
    return f" Did you mean '{matches[0]}'?" if matches else ""


def _semantic_checks(plan: PlanSpec, issues: list[Issue]) -> None:
    ids: dict[str, int] = {}
    for i, node in enumerate(plan.nodes):
        if node.id in ids:
            issues.append(
                Issue(
                    f"$.nodes[{i}].id",
                    f"Duplicate node id '{node.id}' (first used by node {ids[node.id] + 1}).",
                )
            )
        else:
            ids[node.id] = i
    by_title = {n.title.strip().lower(): n.id for n in plan.nodes}
    by_title_slug = {slugify(n.title): n.id for n in plan.nodes}

    def resolve(ref: str, path: str, what: str, node: NodeSpec) -> str | None:
        if ref in ids:
            return ref
        for lookup in (by_title.get(ref.strip().lower()), by_title_slug.get(slugify(ref))):
            if lookup:
                issues.append(
                    Issue(
                        path,
                        f"node '{node.id}': {what} '{ref}' matched node '{lookup}' by title.",
                        "warning",
                    )
                )
                return lookup
        issues.append(
            Issue(
                path,
                f"node '{node.id}' references unknown {what} '{ref}'.{_suggest(ref, ids.keys())}",
            )
        )
        return None

    # Parent references + cycles
    for i, node in enumerate(plan.nodes):
        if node.parent is None:
            continue
        if node.parent == node.id:
            issues.append(
                Issue(f"$.nodes[{i}].parent", f"node '{node.id}' cannot be its own parent.")
            )
            node.parent = None
            continue
        node.parent = resolve(node.parent, f"$.nodes[{i}].parent", "parent", node)
    parent_of = {n.id: n.parent for n in plan.nodes}
    for i, node in enumerate(plan.nodes):
        seen: list[str] = [node.id]
        cur = parent_of.get(node.id)
        while cur is not None:
            if cur in seen:
                issues.append(
                    Issue(f"$.nodes[{i}].parent", f"Parent cycle: {' -> '.join(seen + [cur])}.")
                )
                break
            seen.append(cur)
            cur = parent_of.get(cur)

    # Prerequisite references
    for i, node in enumerate(plan.nodes):
        resolved = []
        seen_prereqs: set[str] = set()
        for j, prereq in enumerate(node.prerequisites):
            path = f"$.nodes[{i}].prerequisites[{j}]"
            if prereq.id == node.id:
                issues.append(Issue(path, f"node '{node.id}' lists itself as a prerequisite."))
                continue
            target = resolve(prereq.id, path, "prerequisite", node)
            if target is None:
                continue
            if target in seen_prereqs:
                issues.append(
                    Issue(
                        path,
                        f"node '{node.id}': prerequisite '{target}' is listed twice.",
                        "warning",
                    )
                )
                continue
            seen_prereqs.add(target)
            prereq.id = target
            resolved.append(prereq)
        node.prerequisites = resolved

    # Prerequisite cycles (DFS over required + recommended edges)
    graph = {n.id: [p.id for p in n.prerequisites] for n in plan.nodes}
    cycle = _find_cycle(graph)
    if cycle:
        idx = ids.get(cycle[0], 0)
        issues.append(
            Issue(
                f"$.nodes[{idx}].prerequisites",
                f"Prerequisites form a cycle: {' -> '.join(cycle)}. A plan must be learnable in some order.",
            )
        )

    # Node-local uniqueness and soft hints
    has_children = {n.parent for n in plan.nodes if n.parent}
    for i, node in enumerate(plan.nodes):
        seen_ex: set[str] = set()
        for j, ex in enumerate(node.exercises):
            if ex.id:
                if ex.id in seen_ex:
                    issues.append(
                        Issue(
                            f"$.nodes[{i}].exercises[{j}].id",
                            f"node '{node.id}': duplicate exercise id '{ex.id}'.",
                        )
                    )
                seen_ex.add(ex.id)
            if not ex.statement and not ex.parts:
                issues.append(
                    Issue(
                        f"$.nodes[{i}].exercises[{j}]",
                        f"node '{node.id}': exercise {j + 1} has neither a statement nor parts.",
                    )
                )
        seen_fc: set[str] = set()
        for j, card in enumerate(node.flashcards):
            if card.id:
                if card.id in seen_fc:
                    issues.append(
                        Issue(
                            f"$.nodes[{i}].flashcards[{j}].id",
                            f"node '{node.id}': duplicate flashcard id '{card.id}'.",
                        )
                    )
                seen_fc.add(card.id)
        for j, res in enumerate(node.resources):
            if res.url and not res.url.lower().startswith(("http://", "https://")):
                issues.append(
                    Issue(
                        f"$.nodes[{i}].resources[{j}].url",
                        f"node '{node.id}': resource URL '{res.url}' is not http(s).",
                        "warning",
                    )
                )
        if node.estimated_minutes == 0 and node.id not in has_children:
            issues.append(
                Issue(
                    f"$.nodes[{i}].estimatedMinutes",
                    f"node '{node.id}' has no time estimate; scheduling will treat it as 30 min.",
                    "warning",
                )
            )

    for key in plan.progress or {}:
        if key not in ids:
            issues.append(
                Issue(
                    f"$.progress.{key}",
                    f"Progress entry for unknown node '{key}' is ignored.",
                    "warning",
                )
            )
    for key in plan.notes or {}:
        if key not in ids:
            issues.append(
                Issue(f"$.notes.{key}", f"Note for unknown node '{key}' is ignored.", "warning")
            )


def _find_cycle(graph: dict[str, list[str]]) -> list[str] | None:
    WHITE, GREY, BLACK = 0, 1, 2
    color = dict.fromkeys(graph, WHITE)
    stack: list[str] = []

    def dfs(u: str) -> list[str] | None:
        color[u] = GREY
        stack.append(u)
        for v in graph.get(u, []):
            if v not in color:
                continue
            if color[v] == GREY:
                return stack[stack.index(v) :] + [v]
            if color[v] == WHITE:
                found = dfs(v)
                if found:
                    return found
        stack.pop()
        color[u] = BLACK
        return None

    for node in graph:
        if color[node] == WHITE:
            found = dfs(node)
            if found:
                return found
    return None


# --------------------------------------------------------------------------- entry point


def _sorted(issues: list[Issue]) -> list[Issue]:
    return sorted(issues, key=lambda i: 0 if i.severity == "error" else 1)


def validate_plan(raw: Any) -> ValidationResult:
    issues: list[Issue] = []
    doc = normalize(raw, issues)
    if any(i.severity == "error" for i in issues):
        return ValidationResult(None, _sorted(issues))
    try:
        plan = PlanSpec.model_validate(doc)
    except ValidationError as exc:
        issues.extend(_pydantic_issues(exc, doc))
        return ValidationResult(None, _sorted(issues))
    _semantic_checks(plan, issues)
    has_errors = any(i.severity == "error" for i in issues)
    return ValidationResult(None if has_errors else plan, _sorted(issues))
