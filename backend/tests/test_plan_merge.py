import json

from sqlalchemy import select

from app.api.subjects import create_subject
from app.core.security import ensure_owner_user
from app.models.exercise import Attempt, Exercise
from app.models.plan import Flashcard, Note, Plan
from app.services.graph import compute_progress, compute_states
from app.services.plan_export import export_plan
from app.services.plan_import import (
    ImportOptions,
    apply_import,
    load_plan,
    preview_import,
    set_status,
)
from app.services.plan_validation import validate_plan
from tests.conftest import load_fixture


def spec_from(doc):
    result = validate_plan(doc)
    assert result.ok, [i.message for i in result.issues]
    return result.plan


def fixture_doc():
    return json.loads(load_fixture("signals_v1.json"))


def make_subject(db):
    user = ensure_owner_user(db)
    return create_subject(db, user.id, "Signals & Systems")


def import_fixture(db, subject, doc=None, **options):
    return apply_import(
        db, spec_from(doc or fixture_doc()), subject, options=ImportOptions(**options)
    )


def node(plan, key):
    return next(n for n in plan.nodes if n.key == key)


def test_initial_import_creates_everything(db_session):
    subject = make_subject(db_session)
    plan = import_fixture(db_session, subject)
    assert plan.key == "signals-and-systems"
    assert plan.exam_date.isoformat() == "2027-02-05"
    assert {n.key for n in plan.nodes} == {
        "foundations",
        "complex-numbers",
        "signals-basics",
        "lti-systems",
        "fourier-series",
    }
    assert node(plan, "complex-numbers").parent_id == node(plan, "foundations").id
    fourier = node(plan, "fourier-series")
    assert sorted((p.prerequisite.key, p.kind) for p in fourier.prerequisites) == [
        ("complex-numbers", "required"),
        ("lti-systems", "recommended"),
    ]
    assert [c.key for c in node(plan, "complex-numbers").flashcards] == ["euler"]
    exercises = list(db_session.scalars(select(Exercise).where(Exercise.plan_id == plan.id)))
    assert (
        len(exercises) == 1
        and exercises[0].key == "lti-systems/rect-conv"
        and len(exercises[0].parts) == 2
    )


def test_reimport_preserves_progress_and_notes_and_updates_content(db_session):
    subject = make_subject(db_session)
    plan = import_fixture(db_session, subject)
    set_status(node(plan, "complex-numbers"), "mastered")
    set_status(node(plan, "signals-basics"), "in_progress")
    node(plan, "signals-basics").note = Note(content="my note")
    db_session.commit()

    doc = fixture_doc()
    basics = next(n for n in doc["nodes"] if n["id"] == "signals-basics")
    basics["title"] = "Signals: classification"
    basics["estimatedMinutes"] = 150
    basics["prerequisites"] = []  # edge removed
    doc["nodes"].append(
        {
            "id": "sampling",
            "title": "Sampling",
            "estimatedMinutes": 100,
            "prerequisites": ["fourier-series"],
        }
    )

    preview = preview_import(db_session, spec_from(doc), subject.id)
    assert preview.mode == "merge" and preview.existing_plan_id == plan.id
    assert preview.counts == {"added": 1, "changed": 1, "unchanged": 4, "removed": 0}
    changed = next(d for d in preview.nodes if d.change == "changed")
    assert changed.key == "signals-basics" and set(changed.fields) == {
        "title",
        "estimated_minutes",
        "prerequisites",
    }
    assert changed.has_progress and changed.has_note

    plan = import_fixture(db_session, subject, doc)
    assert node(plan, "complex-numbers").progress.status == "mastered"
    assert node(plan, "signals-basics").progress.status == "in_progress"
    assert node(plan, "signals-basics").note.content == "my note"
    assert node(plan, "signals-basics").title == "Signals: classification"
    assert node(plan, "signals-basics").prerequisites == []
    assert node(plan, "sampling").prerequisites[0].prerequisite.key == "fourier-series"
    assert (
        db_session.scalar(select(Plan).where(Plan.subject_id == subject.id)).id == plan.id
    )  # still one plan


def test_removed_nodes_are_archived_by_default_or_deleted_on_request(db_session):
    subject = make_subject(db_session)
    plan = import_fixture(db_session, subject)
    set_status(node(plan, "fourier-series"), "understood")
    db_session.commit()

    doc = fixture_doc()
    doc["nodes"] = [n for n in doc["nodes"] if n["id"] != "fourier-series"]
    preview = preview_import(db_session, spec_from(doc), subject.id)
    removed = [d for d in preview.nodes if d.change == "removed"]
    assert [d.key for d in removed] == ["fourier-series"] and removed[0].has_progress

    plan = import_fixture(db_session, subject, doc)
    assert node(plan, "fourier-series").archived is True
    assert node(plan, "fourier-series").progress.status == "understood"
    assert {n.key for n in plan.nodes if not n.archived} == {
        "foundations",
        "complex-numbers",
        "signals-basics",
        "lti-systems",
    }

    # Re-adding it restores the node with its progress intact
    plan = import_fixture(db_session, subject)
    assert node(plan, "fourier-series").archived is False
    assert node(plan, "fourier-series").progress.status == "understood"

    plan = import_fixture(db_session, subject, doc, removed_nodes="delete")
    assert "fourier-series" not in {n.key for n in plan.nodes}


def test_embedded_exercises_and_flashcards_merge_by_key(db_session):
    subject = make_subject(db_session)
    plan = import_fixture(db_session, subject)
    ex = db_session.scalar(select(Exercise).where(Exercise.key == "lti-systems/rect-conv"))
    db_session.add(Attempt(exercise_id=ex.id, result="solved"))
    # user-created flashcard without key must survive
    node(plan, "complex-numbers").flashcards.append(
        Flashcard(key=None, front="mine", back="also mine")
    )
    db_session.commit()

    doc = fixture_doc()
    lti = next(n for n in doc["nodes"] if n["id"] == "lti-systems")
    lti["exercises"][0]["statement"] = "Updated statement"
    lti["exercises"].append({"id": "second", "statement": "Another one"})
    cn = next(n for n in doc["nodes"] if n["id"] == "complex-numbers")
    cn["flashcards"] = [{"id": "euler", "front": "Euler's formula?", "back": "updated"}]

    plan = import_fixture(db_session, subject, doc)
    exercises = {
        e.key: e for e in db_session.scalars(select(Exercise).where(Exercise.plan_id == plan.id))
    }
    assert set(exercises) == {"lti-systems/rect-conv", "lti-systems/second"}
    assert exercises["lti-systems/rect-conv"].id == ex.id  # same row, attempts kept
    assert exercises["lti-systems/rect-conv"].statement == "Updated statement"
    assert len(exercises["lti-systems/rect-conv"].attempts) == 1
    cards = {c.key: c for c in node(plan, "complex-numbers").flashcards}
    assert cards["euler"].back == "updated" and None in cards

    # removing the exercise from the plan keeps it because it has attempts
    lti["exercises"] = []
    plan = import_fixture(db_session, subject, doc)
    keys = {e.key for e in db_session.scalars(select(Exercise).where(Exercise.plan_id == plan.id))}
    assert keys == {"lti-systems/rect-conv"}


def test_progress_block_import_and_export_roundtrip(db_session):
    subject = make_subject(db_session)
    plan = import_fixture(db_session, subject)
    set_status(node(plan, "complex-numbers"), "mastered")
    node(plan, "lti-systems").note = Note(content="conv is flip-shift-multiply")
    db_session.commit()

    doc = export_plan(
        db_session, load_plan(db_session, plan.id), include_progress=True, include_notes=True
    )
    assert doc["schemaVersion"] == 1 and doc["id"] == "signals-and-systems"
    assert doc["progress"]["complex-numbers"]["status"] == "mastered"
    assert doc["notes"]["lti-systems"] == "conv is flip-shift-multiply"
    fourier = next(n for n in doc["nodes"] if n["id"] == "fourier-series")
    assert fourier["prerequisites"] == [
        "complex-numbers",
        {"id": "lti-systems", "kind": "recommended", "note": "Eigenfunctions"},
    ]
    lti = next(n for n in doc["nodes"] if n["id"] == "lti-systems")
    assert lti["exercises"][0]["id"] == "rect-conv" and len(lti["exercises"][0]["parts"]) == 2

    # Import the export into a fresh subject with progress + notes
    user = ensure_owner_user(db_session)
    other = create_subject(db_session, user.id, "Copy")
    assert validate_plan(doc).ok
    copy = apply_import(
        db_session,
        spec_from(doc),
        other,
        options=ImportOptions(import_progress=True, import_notes=True),
    )
    assert node(copy, "complex-numbers").progress.status == "mastered"
    assert node(copy, "lti-systems").note.content == "conv is flip-shift-multiply"
    # Export without progress is a clean share export
    shared = export_plan(db_session, load_plan(db_session, copy.id))
    assert "progress" not in shared and "notes" not in shared


def test_ready_to_learn_and_progress_math(db_session):
    subject = make_subject(db_session)
    plan = import_fixture(db_session, subject)
    states = compute_states(plan.nodes)
    by_key = {n.key: states[n.id] for n in plan.nodes}
    assert (
        by_key["complex-numbers"].ready and not by_key["foundations"].ready
    )  # containers are never "ready"
    assert not by_key["signals-basics"].ready and by_key["signals-basics"].blocked_by == [
        "complex-numbers"
    ]
    # recommended prerequisite does not block
    assert by_key["fourier-series"].blocked_by == ["complex-numbers"]

    set_status(node(plan, "complex-numbers"), "understood")
    db_session.commit()
    states = compute_states(plan.nodes)
    by_key = {n.key: states[n.id] for n in plan.nodes}
    assert by_key["signals-basics"].ready and by_key["fourier-series"].ready
    assert not by_key["complex-numbers"].ready  # already done
    assert (
        by_key["foundations"].descendants_total == 1 and by_key["foundations"].descendants_done == 1
    )

    progress = compute_progress(plan.nodes)
    assert progress.nodes_total == 5 and progress.nodes_done == 1
    assert progress.minutes_total == 90 + 120 + 240 + 180  # grouping node with children counts 0
    assert progress.minutes_done == 90
    assert progress.percent == round(100 * 90 / 630, 1)
