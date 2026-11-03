"""Dump the OpenAPI document for the frontend type generator (npm run gen:api)."""

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("APP_PASSWORD", "x")
os.environ.setdefault("SECRET_KEY", "x" * 32)
os.environ.setdefault("DATA_DIR", str(Path(__file__).resolve().parents[1] / "data"))

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402

out = Path(__file__).resolve().parents[2] / "frontend" / "src" / "api" / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=1), encoding="utf-8")
print(f"wrote {out}")
