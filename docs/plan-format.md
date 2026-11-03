# Learning plan format (schemaVersion 1)

A learning plan is a single JSON document. It is what you import, what the app exports, and what the
"Copy generation prompt" asks an LLM to produce. The format is defined once, as pydantic models in
`backend/app/schemas/plan_format.py`; the validator, the published JSON Schema
(`GET /api/plans/schema.json`) and the generation prompt are all derived from it.

A full, realistic example lives in [`examples/signals-and-systems.json`](examples/signals-and-systems.json).

## Shape at a glance

```jsonc
{
  "schemaVersion": 1,
  "id": "signals-and-systems",          // stable slug; re-importing the same id merges
  "title": "Signals & Systems",
  "subject": "Signals & Systems",       // default subject name when importing
  "language": "en",
  "description": "Markdown + $LaTeX$",
  "exam": { "date": "2027-02-05", "name": "Klausur" },
  "tags": ["bachelor"],
  "resources": [{ "title": "Oppenheim – Signals & Systems", "type": "book" }],
  "meta": { "author": "Claude", "createdAt": "2026-11-03" },
  "nodes": [
    { "id": "foundations", "title": "Mathematical foundations", "estimatedMinutes": 0 },
    {
      "id": "complex-numbers",
      "parent": "foundations",
      "title": "Complex numbers & Euler's formula",
      "description": "Polar form, $e^{j\\theta} = \\cos\\theta + j\\sin\\theta$.",
      "objectives": ["Convert between $a+jb$ and $re^{j\\theta}$"],
      "estimatedMinutes": 90,
      "difficulty": 1,
      "keywords": ["phasor", "Euler"],
      "resources": [{ "title": "Oppenheim App. A", "type": "book" }],
      "flashcards": [{ "id": "euler", "front": "Euler's formula?", "back": "$e^{j\\theta}=\\cos\\theta+j\\sin\\theta$" }]
    },
    {
      "id": "fourier-series",
      "title": "Fourier series",
      "estimatedMinutes": 180,
      "difficulty": 3,
      "prerequisites": [
        "complex-numbers",
        { "id": "lti-systems", "kind": "recommended", "note": "Eigenfunction property motivates the topic" }
      ],
      "exercises": [
        {
          "id": "square-wave",
          "title": "Square wave coefficients",
          "statement": "Compute $a_k$ for a 50 % duty-cycle square wave.",
          "parts": [{ "label": "a", "statement": "Set up the integral.", "solution": "..." }],
          "difficulty": 2
        }
      ]
    }
  ]
}
```

The node list is **flat**: hierarchy is expressed with `parent`, dependencies with `prerequisites`.
Together they form a graph, not a tree — a topic can belong to one chapter and depend on topics in
other chapters.

## Field reference

### Plan (top level)

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | `1` | yes* | *Assumed `1` with a warning when missing. Other values are rejected. |
| `id` | slug | no | Generated from the title when missing. **Merge key** for the plan within a subject. |
| `title` | string | yes | |
| `subject` | string | no | Suggested subject name; the import dialog lets you pick/create one. |
| `language` | BCP-47 code | no | `en`, `de`, … |
| `description` | Markdown | no | |
| `exam` | `{ date: YYYY-MM-DD, name? }` | no | Drives the schedule view and countdowns. |
| `tags` | string[] | no | |
| `resources` | Resource[] | no | Plan-wide resources. |
| `meta` | object | no | Free-form provenance (`author`, `generatedBy`, `createdAt`, …). |
| `nodes` | Node[] | yes | At least one node. |
| `progress` | `{ [nodeId]: { status, updatedAt? } }` | no | Export-only. Imported only when you tick the option. |
| `notes` | `{ [nodeId]: markdown }` | no | Export-only. Imported only when you tick the option. |

### Node

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | slug `^[a-z0-9][a-z0-9-]*$` (≤120) | yes* | *Generated from the title when missing. **Merge key**. Keep ids stable across revisions. |
| `title` | string (≤200) | yes | |
| `parent` | node id | no | Hierarchy. Omit for top-level nodes. |
| `description` | Markdown + LaTeX | no | `$…$` inline, `$$…$$` display. |
| `objectives` | string[] | no | Concrete, checkable learning objectives. |
| `estimatedMinutes` | int ≥ 0 | no (default 0) | Also accepts `"90"`, `"1h30"`, `"45 min"`, `"2.5h"`. Grouping nodes may use 0. |
| `difficulty` | 1–5 | no | |
| `prerequisites` | `(id \| Prerequisite)[]` | no | A plain string means `{ id, kind: "required" }`. |
| `resources` | Resource[] | no | |
| `keywords` | string[] | no | Search terms; also used to match exercises to nodes. |
| `flashcards` | Flashcard[] | no | Seeds spaced repetition. |
| `exercises` | Exercise[] | no | Practice problems that ship with the plan. |
| `children` | Node[] | no | Convenience: nested children are flattened on import and get `parent` set. |

### Prerequisite

| Field | Type | Notes |
|---|---|---|
| `id` | node id | Also accepts a node *title*; resolved with a warning. |
| `kind` | `required` \| `recommended` | `required` blocks the node ("ready to learn" needs all required prerequisites done). `recommended` is drawn dashed and advisory only. |
| `note` | Markdown | Why the prerequisite matters. |

### Resource

| Field | Type | Notes |
|---|---|---|
| `title` | string | required |
| `url` | string | optional; non-http(s) values produce a warning |
| `type` | `book` \| `video` \| `paper` \| `website` \| `course` \| `lecture` \| `other` | default `other` |
| `note` | string | e.g. "Chapter 3.2, pp. 120–134" |

### Flashcard

| Field | Type | Notes |
|---|---|---|
| `id` | string | optional; without it the card is matched by position (`fc-1`, `fc-2`, …) on re-import |
| `front` / `back` | Markdown + LaTeX | required |

### Exercise / ExercisePart

| Field | Type | Notes |
|---|---|---|
| `id` | string | optional; unique within the node. Without it the exercise is matched by position (`ex-1`, …). |
| `number` | string | as printed in the source, e.g. `3.4` |
| `title` | string | |
| `statement` | Markdown + LaTeX | may be empty if everything is in `parts` |
| `parts` | `{ label, statement, hints?, solution? }[]` | sub-parts a, b, c … |
| `hints` | string[] | revealed one at a time in practice mode |
| `solution` | Markdown + LaTeX | |
| `difficulty` | 1–5 | |

## Validation

Validation happens on import, before anything is written. Every finding has a JSON-path-like
`path`, a plain-English `message` and a `severity`:

- **error** – blocks the import. Examples:
  - `$.nodes[4].prerequisites[0]`: `node 'fourier-series' references unknown prerequisite 'complex-numberz'. Did you mean 'complex-numbers'?`
  - duplicate node ids, unknown `parent`, a node listing itself as prerequisite
  - prerequisite cycles (`Prerequisites form a cycle: a -> b -> c -> a`), parent cycles
  - unsupported `schemaVersion`, missing `title`, empty `nodes`
- **warning** – shown, but the import proceeds. Examples: generated ids, flattened children,
  prerequisites resolved by title, unknown fields (with a "did you mean"), nodes without a time
  estimate (the scheduler assumes 30 min), non-http resource URLs.

Errors are listed before warnings. The preview endpoint (`POST /api/plans/import/preview`) returns
the same findings plus the merge diff without saving anything.

## Forgiving input

The importer fixes what it safely can and tells you about it:

- missing `schemaVersion` → assumed 1
- missing or invalid ids → slugified from the title (`"Komplexe Zahlen & Euler"` → `komplexe-zahlen-euler`), de-duplicated with `-2`, `-3`, …; references to the old id are rewritten
- nested `children` → flattened, `parent` filled in
- prerequisite strings that match a node *title* → resolved to the id
- `estimatedMinutes` as a human string → parsed
- unknown fields → ignored with a warning

### Markdown outline fallback

If the pasted text is not JSON, it is parsed as an outline:

```markdown
# Signale und Systeme
exam: 2027-02-05 Klausur
language: de

## Grundlagen
### Komplexe Zahlen
Polarform, $e^{j\theta}$.
- time: 1h30
- difficulty: 1
- objectives:
  - Umrechnen zwischen Formen
- keywords: phasor, euler

### Elementare Signale
time: 45 min
prerequisites: Komplexe Zahlen

## LTI-Systeme
requires: Elementare Signale
```

`#` is the plan title, `##`/`###`/`####` become nodes nested by heading depth. Inside a node,
`key: value` lines set attributes (`prerequisites|requires|voraussetzungen`, `time|estimated|dauer`,
`difficulty`, `objectives|ziele` with nested bullets, `keywords|tags`, `id`); everything else is the
description. A pure bullet list (no `##` headings) is also accepted — bullets become nodes nested by
indentation.

## Re-import & merge

Importing a plan whose `id` already exists in the chosen subject (or using "Update from file" on a
plan) **merges** instead of replacing:

| | |
|---|---|
| Node matching | by `id` |
| Content fields (title, description, objectives, estimate, difficulty, resources, keywords, parent, order) | overwritten from the file |
| Prerequisite edges | replaced by the file's edges |
| Status, timestamps, notes, exercise attempts | **never touched** |
| Nodes missing from the file | archived (hidden, progress kept) by default; "Delete" is an explicit option. Re-adding an archived id restores it with its progress. |
| Embedded flashcards | matched by `id` (or position); cards you created in the app (no key) are untouched |
| Embedded exercises | matched by `id` (or position); exercises with logged attempts are kept even if removed from the file |
| `progress` / `notes` blocks | only applied when the corresponding checkbox is ticked; existing progress is kept unless "overwrite" is chosen |

The preview shows the exact diff (added / changed / unchanged / removed, which fields changed, and
whether a removed node has progress or notes) before you confirm.

## Export

`GET /api/plans/{id}/export?include_progress=true&include_notes=true` returns the plan in this format.
With both flags `false` you get a clean file for sharing; with them `true` the file also contains
`progress` and `notes` blocks, which another instance can import to restore your state.

## Versioning

`schemaVersion` is bumped only for breaking changes. New optional fields are added without a bump.
The importer keeps accepting every previous version and upgrades it on the fly.
