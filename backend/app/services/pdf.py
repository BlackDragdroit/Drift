"""PDF helpers built on PyMuPDF: inspection, page rendering, figure cropping, page-range extraction.

All page numbers in this module are 1-based (as printed in PDF viewers and as the model reports them).
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from app.core.config import get_settings

PAGE_ZOOM = 1.5  # ~108 dpi preview images for the review screen
FIGURE_ZOOM = 200 / 72  # 200 dpi crops
MIN_TEXT_CHARS_PER_PAGE = 40


@dataclass
class PdfInfo:
    page_count: int
    has_text_layer: bool
    sha256: str
    size_bytes: int


def inspect_pdf(path: Path) -> PdfInfo:
    data = path.read_bytes()
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        if doc.needs_pass:
            raise ValueError("Encrypted PDFs are not supported.")
        n = doc.page_count
        # Sample up to 6 pages spread over the document to decide whether it is scanned.
        sample = sorted({int(i * max(n - 1, 0) / 5) for i in range(6)}) if n else []
        texty = sum(
            1 for i in sample if len(doc[i].get_text("text").strip()) >= MIN_TEXT_CHARS_PER_PAGE
        )
        has_text = bool(sample) and texty >= max(1, len(sample) // 2)
    return PdfInfo(
        page_count=n,
        has_text_layer=has_text,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
    )


def page_text(path: Path, page: int) -> str:
    with pymupdf.open(path) as doc:
        return doc[page - 1].get_text("text")


def render_page_png(path: Path, page: int, zoom: float = PAGE_ZOOM) -> bytes:
    with pymupdf.open(path) as doc:
        if not 1 <= page <= doc.page_count:
            raise ValueError(f"Page {page} out of range (1-{doc.page_count}).")
        pix = doc[page - 1].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        return pix.tobytes("png")


def render_page_jpeg(path: Path, page: int, zoom: float = 1.4, quality: int = 80) -> bytes:
    """Compact page image for sending scanned pages to the model."""
    with pymupdf.open(path) as doc:
        pix = doc[page - 1].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        return pix.tobytes("jpeg", jpg_quality=quality)


def cached_page_image(doc_id: int, path: Path, page: int, zoom: float = PAGE_ZOOM) -> Path:
    cache_dir = get_settings().uploads_dir / "pages" / str(doc_id)
    cache_dir.mkdir(parents=True, exist_ok=True)
    out = cache_dir / f"{page}@{zoom:g}.png"
    if not out.exists():
        out.write_bytes(render_page_png(path, page, zoom))
    return out


def clamp_bbox(
    bbox: list[float] | tuple[float, ...], margin: float = 0.01
) -> tuple[float, float, float, float]:
    """Normalise a model-reported bbox: order corners, reject tiny boxes, add a margin, clamp to the page."""
    if len(bbox) != 4:
        raise ValueError("bbox must have 4 numbers")
    x0, y0, x1, y1 = (float(v) for v in bbox)
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    x0, y0, x1, y1 = max(0.0, x0), max(0.0, y0), min(1.0, x1), min(1.0, y1)
    if x1 - x0 < 0.015 or y1 - y0 < 0.015:
        raise ValueError("bbox too small")
    return (
        max(0.0, x0 - margin),
        max(0.0, y0 - margin),
        min(1.0, x1 + margin),
        min(1.0, y1 + margin),
    )


def crop_figure(
    doc_id: int,
    path: Path,
    page: int,
    bbox: list[float] | tuple[float, ...],
    zoom: float = FIGURE_ZOOM,
) -> tuple[str, tuple[float, float, float, float]]:
    """Crop a region (normalised 0-1 coordinates, origin top-left) and save it as PNG.

    Returns (relative path under the uploads dir, clamped bbox).
    """
    x0, y0, x1, y1 = clamp_bbox(bbox)
    with pymupdf.open(path) as doc:
        if not 1 <= page <= doc.page_count:
            raise ValueError(f"Page {page} out of range (1-{doc.page_count}).")
        pg = doc[page - 1]
        rect = pg.rect
        clip = pymupdf.Rect(
            rect.x0 + x0 * rect.width,
            rect.y0 + y0 * rect.height,
            rect.x0 + x1 * rect.width,
            rect.y0 + y1 * rect.height,
        )
        pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False)
        data = pix.tobytes("png")
    rel = Path("figures") / str(doc_id) / f"{uuid.uuid4().hex[:12]}.png"
    out = get_settings().uploads_dir / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return rel.as_posix(), (x0, y0, x1, y1)


def sub_pdf_bytes(path: Path, page_from: int, page_to: int) -> bytes:
    """A new PDF containing only pages page_from..page_to (1-based, inclusive)."""
    with pymupdf.open(path) as src:
        out = pymupdf.open()
        out.insert_pdf(src, from_page=page_from - 1, to_page=page_to - 1)
        data = out.tobytes(garbage=3, deflate=True)
        out.close()
    return data


def store_upload(subject_id: int, filename: str, data: bytes) -> tuple[Path, str]:
    """Persist an uploaded PDF under uploads/documents/ (content-addressed per subject).

    Returns (absolute path, relative path). The original filename lives in the database.
    """
    digest = hashlib.sha256(data).hexdigest()
    rel = Path("documents") / f"s{subject_id}-{digest[:16]}.pdf"
    out = get_settings().uploads_dir / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        out.write_bytes(data)
    return out, rel.as_posix()
