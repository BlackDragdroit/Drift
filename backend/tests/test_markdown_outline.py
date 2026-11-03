from app.services.plan_markdown import looks_like_markdown, markdown_to_plan
from app.services.plan_validation import validate_plan

HEADINGS = """# Signale und Systeme
exam: 2027-02-05 Klausur
language: de

Überblick über LTI-Systeme.

## Grundlagen

### Komplexe Zahlen
Polarform, $e^{j\\theta}$.
- time: 1h30
- difficulty: 1
- objectives:
  - Umrechnen zwischen Formen
  - Euler erklären
- keywords: phasor, euler

### Elementare Signale
time: 45 min
prerequisites: Komplexe Zahlen

## LTI-Systeme
Faltung und Impulsantwort.
requires: Elementare Signale, komplexe-zahlen
"""

BULLETS = """- Grundlagen
  - Komplexe Zahlen
    - time: 90
  - Elementare Signale
    - prerequisites: Komplexe Zahlen
- LTI-Systeme
  - requires: Elementare Signale
"""


def test_detects_markdown_vs_json():
    assert looks_like_markdown(HEADINGS)
    assert looks_like_markdown(BULLETS)
    assert not looks_like_markdown('{"title": "x"}')


def test_headings_outline():
    doc = markdown_to_plan(HEADINGS)
    assert doc["title"] == "Signale und Systeme"
    assert doc["exam"] == {"date": "2027-02-05", "name": "Klausur"}
    assert doc["language"] == "de"
    assert doc["description"] == "Überblick über LTI-Systeme."
    nodes = {n["id"]: n for n in doc["nodes"]}
    assert set(nodes) == {"grundlagen", "komplexe-zahlen", "elementare-signale", "lti-systeme"}
    cz = nodes["komplexe-zahlen"]
    assert cz["parent"] == "grundlagen"
    assert cz["estimatedMinutes"] == "1h30"
    assert cz["difficulty"] == 1
    assert cz["objectives"] == ["Umrechnen zwischen Formen", "Euler erklären"]
    assert cz["keywords"] == ["phasor", "euler"]
    assert cz["description"] == "Polarform, $e^{j\\theta}$."
    assert nodes["elementare-signale"]["prerequisites"] == ["Komplexe Zahlen"]
    assert nodes["lti-systeme"]["prerequisites"] == ["Elementare Signale", "komplexe-zahlen"]
    assert "parent" not in nodes["lti-systeme"]

    result = validate_plan(doc)
    assert result.ok, [i.message for i in result.issues]
    lti = next(n for n in result.plan.nodes if n.id == "lti-systeme")
    assert sorted(p.id for p in lti.prerequisites) == ["elementare-signale", "komplexe-zahlen"]
    assert next(n for n in result.plan.nodes if n.id == "komplexe-zahlen").estimated_minutes == 90


def test_bullet_outline():
    doc = markdown_to_plan(BULLETS)
    nodes = {n["id"]: n for n in doc["nodes"]}
    assert nodes["komplexe-zahlen"]["parent"] == "grundlagen"
    assert nodes["komplexe-zahlen"]["estimatedMinutes"] == "90"
    assert nodes["elementare-signale"]["prerequisites"] == ["Komplexe Zahlen"]
    assert nodes["lti-systeme"]["prerequisites"] == ["Elementare Signale"]
    assert "parent" not in nodes["lti-systeme"]
    assert validate_plan(doc).ok
