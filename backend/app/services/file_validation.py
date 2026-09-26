"""Upload validation: identify files by their bytes (magic numbers), never by the name or
the Content-Type the client sends, and only accept an allowlist of harmless formats.

Deliberately NOT allowed: SVG and HTML (can carry scripts), executables and archives in
general. Office files are accepted only as genuine OOXML zips (DOCX/XLSX) without macros.
"""

import io
import re
import unicodedata
import zipfile
from dataclasses import dataclass


@dataclass(frozen=True)
class FileKind:
    kind: str  # short id stored with the document
    content_type: str
    extensions: tuple[str, ...]
    # Safe to show inline in the browser (inside a CSP sandbox).
    inline: bool


KINDS = {
    "pdf": FileKind("pdf", "application/pdf", (".pdf",), True),
    "png": FileKind("png", "image/png", (".png",), True),
    "jpeg": FileKind("jpeg", "image/jpeg", (".jpg", ".jpeg"), True),
    "webp": FileKind("webp", "image/webp", (".webp",), True),
    "txt": FileKind("txt", "text/plain; charset=utf-8", (".txt",), False),
    "csv": FileKind("csv", "text/csv; charset=utf-8", (".csv",), False),
    "docx": FileKind("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", (".docx",), False),
    "xlsx": FileKind("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", (".xlsx",), False),
}

ALLOWED_EXTENSIONS = sorted({ext for kind in KINDS.values() for ext in kind.extensions})
ACCEPTED_DESCRIPTION = "PDF, PNG, JPEG, WebP, TXT, CSV, DOCX or XLSX"


class FileValidationError(ValueError):
    pass


_SAFE_PUNCTUATION = set(".-_ ()[]")


def _safe_char(char: str) -> str:
    # Letters, combining marks and digits from any script (so Devanagari vowel signs
    # like ा and ि survive), plus a little harmless punctuation. Everything else -> "_".
    if char in _SAFE_PUNCTUATION or unicodedata.category(char)[0] in ("L", "M", "N"):
        return char
    return "_"


def safe_filename(name: str | None, fallback: str = "document") -> str:
    """Strip directories and control/odd characters; keep a readable, bounded name."""
    name = unicodedata.normalize("NFC", name or "")
    name = re.split(r"[\\/]", name)[-1]  # drop any path (both separators)
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    name = "".join(_safe_char(c) for c in name).strip(" .")
    if not name:
        name = fallback
    stem, dot, ext = name.rpartition(".")
    if dot and len(ext) <= 10:
        return f"{stem[: 255 - len(ext) - 1]}.{ext}"
    return name[:255]


def _extension(filename: str) -> str:
    return ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""


def _looks_like_text(head: bytes) -> bool:
    if b"\x00" in head:
        return False
    try:
        head.decode("utf-8")
        return True
    except UnicodeDecodeError as exc:
        # A multi-byte character may be cut at the end of the sample.
        return exc.start >= len(head) - 3


def _ooxml_kind(data: bytes) -> str | None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = set(archive.namelist())
    except zipfile.BadZipFile:
        return None
    if "[Content_Types].xml" not in names:
        return None
    if any(n.lower().endswith("vbaproject.bin") for n in names):
        raise FileValidationError("Office files with macros aren't accepted.")
    if "word/document.xml" in names:
        return "docx"
    if "xl/workbook.xml" in names:
        return "xlsx"
    return None


def detect_kind(data: bytes, filename: str) -> FileKind:
    """Return the file's real kind, or raise if it isn't allowed or doesn't match its extension."""
    if not data:
        raise FileValidationError("The file is empty.")
    ext = _extension(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise FileValidationError(f"This file type isn't allowed. Upload a {ACCEPTED_DESCRIPTION} file.")

    head = data[:4096]
    detected: str | None = None
    if head.startswith(b"%PDF-"):
        detected = "pdf"
    elif head.startswith(b"\x89PNG\r\n\x1a\n"):
        detected = "png"
    elif head.startswith(b"\xff\xd8\xff"):
        detected = "jpeg"
    elif head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        detected = "webp"
    elif head.startswith(b"PK\x03\x04"):
        detected = _ooxml_kind(data)
    elif _looks_like_text(head):
        lowered = head.lstrip().lower()
        if lowered.startswith((b"<!doctype html", b"<html", b"<svg", b"<?xml", b"<script")):
            raise FileValidationError("HTML/SVG/XML content isn't accepted.")
        detected = "csv" if ext == ".csv" else "txt"

    if detected is None:
        raise FileValidationError(f"The file's contents aren't a supported type. Upload a {ACCEPTED_DESCRIPTION} file.")
    kind = KINDS[detected]
    if ext not in kind.extensions:
        raise FileValidationError(f"The file extension doesn't match its contents (looks like {detected.upper()}).")
    return kind
