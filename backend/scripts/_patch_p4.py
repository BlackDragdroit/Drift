from pathlib import Path

root = Path(__file__).resolve().parents[1]


def patch(rel, pairs):
    p = root / rel
    s = p.read_text(encoding="utf-8")
    for old, new in pairs:
        if new in s:
            continue
        if old not in s:
            raise SystemExit(f"{rel}: not found: {old[:100]!r}")
        s = s.replace(old, new, 1)
    p.write_text(s, encoding="utf-8")
    print("patched", rel)


patch(
    "app/api/router.py",
    [
        ("    exercises,\n    files,\n", "    exercises,\n    files,\n    flashcards,\n"),
        ("    subjects,\n)", "    subjects,\n    system,\n)"),
        (
            "practice, sessions, search, files):",
            "practice, sessions, search, flashcards, system, files):",
        ),
    ],
)

patch(
    "app/api/dashboard.py",
    [
        (
            "from app.services import activity\n",
            "from app.services import activity\nfrom app.services.flashcards import due_counts\n",
        ),
        (
            "    active_session = activity.active_session(db)\n",
            "    active_session = activity.active_session(db)\n    cards = due_counts(db, user.id)\n",
        ),
        (
            "    return DashboardOut(\n        subjects_count=len(subjects),",
            '    return DashboardOut(\n        flashcards_due=cards["due"],\n        flashcards_new=cards["new"],\n        subjects_count=len(subjects),',
        ),
    ],
)

# plan import: embedded flashcards get source "plan" (default) - nothing to do; node detail already lists cards.
