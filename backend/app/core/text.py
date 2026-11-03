import re
import unicodedata

_TRANSLIT = str.maketrans(
    {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "ae", "Ö": "oe", "Ü": "ue"}
)
_NON_SLUG = re.compile(r"[^a-z0-9]+")
SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]*$"
SLUG_RE = re.compile(SLUG_PATTERN)


def slugify(value: str, max_length: int = 60) -> str:
    value = value.translate(_TRANSLIT)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = _NON_SLUG.sub("-", value.lower()).strip("-")
    value = value[:max_length].rstrip("-")
    return value or "item"


def unique_slug(base: str, taken: set[str]) -> str:
    if base not in taken:
        return base
    i = 2
    while f"{base}-{i}" in taken:
        i += 1
    return f"{base}-{i}"


_DURATION_RE = re.compile(
    r"^\s*(?:(?P<h>\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours|std|stunden?))?\s*"
    r"(?:(?P<m>\d+)\s*(?:m|min|mins|minute|minutes|minuten)?)?\s*$",
    re.IGNORECASE,
)


def parse_minutes(value: object) -> int | None:
    """Accepts 90, "90", "90 min", "1.5h", "1h30", "1h 30min". Returns None if unparseable."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return int(round(value)) if value >= 0 else None
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.isdigit():
        return int(text)
    m = _DURATION_RE.match(text)
    if not m or (m.group("h") is None and m.group("m") is None):
        return None
    hours = float(m.group("h").replace(",", ".")) if m.group("h") else 0.0
    minutes = int(m.group("m")) if m.group("m") else 0
    return int(round(hours * 60 + minutes))
