import pymupdf
import pytest

from app.core.config import get_settings
from app.services import pdf as pdfsvc
from tests.pdf_fixtures import make_scanned_pdf, make_text_pdf


def test_inspect_text_pdf(tmp_path):
    path = make_text_pdf(tmp_path / "sheet.pdf", pages=4)
    info = pdfsvc.inspect_pdf(path)
    assert info.page_count == 4
    assert info.has_text_layer is True
    assert len(info.sha256) == 64 and info.size_bytes > 1000


def test_inspect_scanned_pdf(tmp_path):
    path = make_scanned_pdf(tmp_path / "scan.pdf", pages=2)
    info = pdfsvc.inspect_pdf(path)
    assert info.page_count == 2
    assert info.has_text_layer is False


def test_render_and_cache(tmp_path):
    path = make_text_pdf(tmp_path / "sheet.pdf", pages=1)
    png = pdfsvc.render_page_png(path, 1, zoom=1.0)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    pix = pymupdf.Pixmap(png)
    assert (pix.width, pix.height) == (595, 842)
    cached = pdfsvc.cached_page_image(42, path, 1)
    assert cached.exists() and cached.parent.name == "42"
    assert cached == pdfsvc.cached_page_image(42, path, 1)  # second call reuses the file
    with pytest.raises(ValueError):
        pdfsvc.render_page_png(path, 2)


def test_crop_figure_writes_png_with_expected_size(tmp_path):
    path = make_text_pdf(tmp_path / "sheet.pdf", pages=1)
    # the blue box is at x 150-450 / 595, y 300-500 / 842
    rel, bbox = pdfsvc.crop_figure(7, path, 1, [150 / 595, 300 / 842, 450 / 595, 520 / 842])
    out = get_settings().uploads_dir / rel
    assert out.exists() and rel.startswith("figures/7/")
    assert bbox[0] < 150 / 595 < bbox[2]  # margin was added
    pix = pymupdf.Pixmap(out.read_bytes())
    w, h = pix.width, pix.height
    expected_w = (bbox[2] - bbox[0]) * 595 * pdfsvc.FIGURE_ZOOM
    assert abs(w - expected_w) < 3 and h > 0


def test_clamp_bbox_orders_and_rejects_tiny():
    assert pdfsvc.clamp_bbox([0.9, 0.9, 0.1, 0.1], margin=0) == (0.1, 0.1, 0.9, 0.9)
    assert pdfsvc.clamp_bbox([-0.5, 0.2, 1.7, 0.4], margin=0) == (0.0, 0.2, 1.0, 0.4)
    with pytest.raises(ValueError):
        pdfsvc.clamp_bbox([0.5, 0.5, 0.505, 0.505])


def test_sub_pdf_has_requested_pages(tmp_path):
    path = make_text_pdf(tmp_path / "sheet.pdf", pages=5)
    data = pdfsvc.sub_pdf_bytes(path, 2, 4)
    with pymupdf.open(stream=data, filetype="pdf") as sub:
        assert sub.page_count == 3
        assert "page 2" in sub[0].get_text()
        assert "page 4" in sub[2].get_text()


def test_store_upload_dedupes_by_content(tmp_path):
    data = make_text_pdf(tmp_path / "x.pdf").read_bytes()
    p1, rel1 = pdfsvc.store_upload(1, "Übung 3 (final).pdf", data)
    p2, rel2 = pdfsvc.store_upload(1, "other name.pdf", data)
    assert p1 == p2 and rel1 == rel2
    assert rel1.startswith("documents/s1-") and rel1.endswith(".pdf") and filename_free(rel1)


def filename_free(rel: str) -> bool:
    return "bung" not in rel and "other" not in rel
