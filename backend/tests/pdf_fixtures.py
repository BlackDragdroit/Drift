"""Generate small PDFs for tests with PyMuPDF (no binary fixtures in the repo)."""

from pathlib import Path

import pymupdf


def make_text_pdf(path: Path, pages: int = 3, with_figure: bool = True) -> Path:
    doc = pymupdf.open()
    for i in range(1, pages + 1):
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 80), f"Exercise sheet - page {i}", fontsize=16)
        page.insert_text(
            (72, 120),
            f"Aufgabe {i}: Compute the convolution of rect(t) and rect(t/2).",
            fontsize=11,
        )
        page.insert_text((90, 140), "a) Sketch both signals.", fontsize=11)
        page.insert_text((90, 160), "b) Compute y(t) = (x * h)(t).", fontsize=11)
        if with_figure:
            # a "figure": filled rectangle with a frame in the middle of the page
            rect = pymupdf.Rect(150, 300, 450, 500)
            page.draw_rect(rect, color=(0, 0, 0), fill=(0.2, 0.5, 0.9), width=2)
            page.insert_text((150, 520), f"Figure {i}: a blue box", fontsize=10)
    doc.save(path)
    doc.close()
    return path


def make_scanned_pdf(path: Path, pages: int = 2) -> Path:
    """Image-only pages (no text layer)."""
    src = pymupdf.open()
    p = src.new_page(width=595, height=842)
    p.insert_text((72, 80), "This text becomes pixels", fontsize=20)
    pix = p.get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2))
    png = pix.tobytes("png")
    src.close()
    doc = pymupdf.open()
    for _ in range(pages):
        page = doc.new_page(width=595, height=842)
        page.insert_image(page.rect, stream=png)
    doc.save(path)
    doc.close()
    return path
