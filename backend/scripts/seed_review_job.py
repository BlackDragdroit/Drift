"""Dev helper: create a document + an extraction job in 'review' state from the test fixtures.

Lets you try the review screen without an Anthropic API key:
    uv run python scripts/seed_review_job.py [subject_id]
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.db import get_sessionmaker, run_migrations  # noqa: E402
from app.models.document import Document, ExtractionJob  # noqa: E402
from app.models.subject import Subject  # noqa: E402
from app.services import extraction  # noqa: E402
from app.services import pdf as pdfsvc
from tests.pdf_fixtures import make_text_pdf  # noqa: E402

run_migrations()
with get_sessionmaker()() as db:
    subject_id = (
        int(sys.argv[1])
        if len(sys.argv) > 1
        else db.scalar(select(Subject.id).order_by(Subject.id))
    )
    if subject_id is None:
        sys.exit("No subject found. Create one in the app first.")
    tmp = Path("data") / "seed-sheet.pdf"
    tmp.parent.mkdir(exist_ok=True)
    make_text_pdf(tmp, pages=4)
    data = tmp.read_bytes()
    abs_path, rel = pdfsvc.store_upload(subject_id, "Uebungsblatt 3.pdf", data)
    info = pdfsvc.inspect_pdf(abs_path)
    doc = Document(
        subject_id=subject_id,
        filename="Uebungsblatt 3.pdf",
        title="Übungsblatt 3 (seed)",
        path=rel,
        sha256=info.sha256,
        size_bytes=info.size_bytes,
        page_count=info.page_count,
        has_text_layer=info.has_text_layer,
    )
    db.add(doc)
    db.flush()
    fixtures = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
    chunks = [
        extraction.parse_chunk(json.loads((fixtures / f).read_text(encoding="utf-8")))
        for f in ("extraction_chunk_1.json", "extraction_chunk_2.json")
    ]
    built = extraction.build_drafts(extraction.stitch(chunks), doc.id, abs_path)
    job = ExtractionJob(
        document_id=doc.id,
        status="review",
        model="seed",
        page_from=1,
        page_to=4,
        chunks_total=2,
        chunks_done=2,
        draft=built.drafts,
        notes=["Seeded from test fixtures (no API call).", *built.warnings],
        input_tokens=4200,
        output_tokens=1800,
    )
    db.add(job)
    db.commit()
    print(f"document {doc.id}, job {job.id} -> http://localhost:5173/jobs/{job.id}/review")
