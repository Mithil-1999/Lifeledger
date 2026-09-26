import hashlib
import io
import zipfile

import pytest

from app.core.config import get_settings
from app.services.file_validation import FileValidationError, detect_kind, safe_filename
from tests.conftest import make_client, requires_db
from tests.test_auth import register

# --- Sample files (real signatures) -----------------------------------------------------------------------------

PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 40
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 40
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 30
TXT = "Passport renewal checklist — नेपाल\n".encode()
EXE = b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 60
HTML = b"<!DOCTYPE html><html><script>alert(1)</script></html>"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def ooxml(kind: str, macro: bool = False) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml" if kind == "docx" else "xl/workbook.xml", "<x/>")
        if macro:
            z.writestr("xl/vbaProject.bin", b"\x00")
    return buffer.getvalue()


# --- Pure validation --------------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "name", "kind"),
    [
        (PDF, "statement.pdf", "pdf"),
        (PNG, "scan.PNG", "png"),
        (JPEG, "photo.jpeg", "jpeg"),
        (WEBP, "photo.webp", "webp"),
        (TXT, "notes.txt", "txt"),
        (b"date,amount\n2026-09-01,1500\n", "export.csv", "csv"),
        (ooxml("docx"), "cv.docx", "docx"),
        (ooxml("xlsx"), "budget.xlsx", "xlsx"),
    ],
)
def test_accepted_files_are_detected_by_content(data, name, kind):
    assert detect_kind(data, name).kind == kind


@pytest.mark.parametrize(
    ("data", "name", "fragment"),
    [
        (b"", "empty.pdf", "empty"),
        (EXE, "invoice.pdf", "aren't a supported type"),  # executable disguised as a PDF
        (EXE, "tool.exe", "isn't allowed"),
        (PNG, "photo.pdf", "doesn't match"),  # real PNG with a .pdf name
        (HTML, "page.txt", "HTML/SVG"),
        (SVG, "logo.svg", "isn't allowed"),
        (SVG, "logo.png", "HTML/SVG"),
        (ooxml("xlsx", macro=True), "macro.xlsx", "macros"),
        (b"PK\x03\x04not really a zip", "fake.docx", "aren't a supported type"),
        (PDF, "noextension", "isn't allowed"),
    ],
)
def test_rejected_files(data, name, fragment):
    with pytest.raises(FileValidationError, match=fragment):
        detect_kind(data, name)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("../../etc/passwd", "passwd"),
        ("C:\\Windows\\system32\\evil.pdf", "evil.pdf"),
        ("my bill (Sept).pdf", "my bill (Sept).pdf"),
        ('a"b<c>.pdf', "a_b_c_.pdf"),
        ("", "document"),
        ("..", "document"),
        ("x" * 300 + ".pdf", "x" * 251 + ".pdf"),
        ("नागरिकता प्रमाणपत्र.pdf", "नागरिकता प्रमाणपत्र.pdf"),  # Devanagari marks preserved
        ("bill;rm -rf ~.pdf", "bill_rm -rf _.pdf"),
    ],
)
def test_safe_filename(raw, expected):
    assert safe_filename(raw) == expected


# --- Notes --------------------------------------------------------------------------------------------------------------


@pytest.fixture
def user(client):
    register(client)
    return client


def other_user():
    other = make_client()
    register(other, username="other", email="other@example.com")
    return other


def create_note(client, title="Bank account details", **extra):
    return client.post("/api/notes", json={"title": title, **extra})


@requires_db
def test_note_crud(user):
    created = create_note(user, content="Branch: Kathmandu\n<script>alert(1)</script>", category="finance", tags=["#Bank", " bank ", "NIC Asia"])
    assert created.status_code == 201
    note = created.json()
    assert note["category"] == "finance" and note["tags"] == ["bank", "nic-asia"]
    # Stored verbatim as plain text; the UI never renders it as HTML.
    assert "<script>" in note["content"]

    updated = user.put(f"/api/notes/{note['id']}", json={"title": "Bank", "content": "", "category": "important", "tags": []}).json()
    assert updated["title"] == "Bank" and updated["tags"] == [] and updated["category"] == "important"

    assert user.get(f"/api/notes/{note['id']}").status_code == 200
    assert user.delete(f"/api/notes/{note['id']}").status_code == 204
    assert user.get(f"/api/notes/{note['id']}").status_code == 404


@requires_db
@pytest.mark.parametrize(
    ("payload", "status_code"),
    [
        ({"title": ""}, 422),
        ({"category": "secret"}, 422),
        ({"tags": ["no spaces!"]}, 422),
        ({"tags": [f"t{i}" for i in range(21)]}, 422),
        ({"content": "x" * 100_001}, 422),
    ],
)
def test_note_validation(user, payload, status_code):
    assert user.post("/api/notes", json={"title": "N", **payload}).status_code == status_code


@requires_db
def test_pin_archive_and_ordering(user):
    a = create_note(user, "A").json()
    b = create_note(user, "B").json()
    create_note(user, "C")
    user.patch(f"/api/notes/{a['id']}", json={"is_pinned": True})
    titles = [n["title"] for n in user.get("/api/notes").json()["items"]]
    assert titles[0] == "A"  # pinned first, then most recently edited

    archived = user.patch(f"/api/notes/{a['id']}", json={"is_archived": True}).json()
    assert archived["is_archived"] is True and archived["is_pinned"] is False  # archiving unpins
    assert user.patch(f"/api/notes/{a['id']}", json={"is_pinned": True}).status_code == 409

    body = user.get("/api/notes", params={"view": "archived"}).json()
    assert [n["title"] for n in body["items"]] == ["A"]
    assert body["counts"] == {"active": 2, "archived": 1, "pinned": 0}
    assert len(user.get("/api/notes", params={"view": "all"}).json()["items"]) == 3

    user.patch(f"/api/notes/{a['id']}", json={"is_archived": False})
    assert "A" in [n["title"] for n in user.get("/api/notes").json()["items"]]
    assert b["id"]


@requires_db
def test_note_search_filters_and_tags(user):
    create_note(user, "Exam timetable", content="Physics on Sunday", category="education", tags=["exam", "tu"])
    create_note(user, "Startup idea", content="Momo delivery app", category="ideas", tags=["business"])
    create_note(user, "Wi-Fi password location", content="Under the router", category="personal", tags=["home", "exam"])
    get = lambda **p: [n["title"] for n in user.get("/api/notes", params=p).json()["items"]]  # noqa: E731
    assert get(search="momo") == ["Startup idea"]
    assert get(search="physics") == ["Exam timetable"]
    assert sorted(get(search="business")) == ["Startup idea"]  # tags are searchable
    assert get(category="ideas") == ["Startup idea"]
    assert sorted(get(tag="#EXAM")) == ["Exam timetable", "Wi-Fi password location"]
    assert get(search="100%") == []
    assert user.get("/api/notes/tags").json() == [{"tag": "exam", "count": 2}, {"tag": "business", "count": 1}, {"tag": "home", "count": 1}, {"tag": "tu", "count": 1}]


@requires_db
def test_notes_are_private(user):
    note = create_note(user).json()
    other = other_user()
    assert other.get("/api/notes").json()["items"] == []
    assert other.get(f"/api/notes/{note['id']}").status_code == 404
    assert other.put(f"/api/notes/{note['id']}", json={"title": "x"}).status_code == 404
    assert other.patch(f"/api/notes/{note['id']}", json={"is_pinned": True}).status_code == 404
    assert other.delete(f"/api/notes/{note['id']}").status_code == 404


# --- Documents ------------------------------------------------------------------------------------------------------------


def upload(client, data=PDF, name="statement.pdf", category="finance", **fields):
    return client.post("/api/documents", files={"file": (name, data, "application/octet-stream")}, data={"category": category, **fields})


def stored_path(document):
    from app.db.session import SessionLocal
    from app.models import Document
    from app.services.documents import file_path

    with SessionLocal() as db:
        return file_path(db.get(Document, document["id"]))


@requires_db
def test_upload_view_download_delete(user):
    response = upload(user, title="NIC Asia statement", description="September", document_date="2026-09-30")
    assert response.status_code == 201
    doc = response.json()
    assert doc["file_kind"] == "pdf" and doc["content_type"] == "application/pdf" and doc["previewable"] is True
    assert doc["size_bytes"] == len(PDF) and doc["sha256"] == hashlib.sha256(PDF).hexdigest()
    assert doc["original_filename"] == "statement.pdf" and doc["document_date"] == "2026-09-30"

    path = stored_path(doc)
    assert path.read_bytes() == PDF
    assert path.suffix == "" and "statement" not in path.name  # random key, no user-controlled name
    assert path.parent.name == str(user.get("/api/auth/me").json()["id"])

    meta = user.get(f"/api/documents/{doc['id']}").json()
    assert meta["title"] == "NIC Asia statement"

    download = user.get(f"/api/documents/{doc['id']}/download")
    assert download.status_code == 200 and download.content == PDF
    assert download.headers["content-type"] == "application/pdf"
    assert download.headers["content-disposition"].startswith("attachment;")
    assert download.headers["cache-control"] == "private, no-store"
    assert download.headers["x-content-type-options"] == "nosniff"

    inline = user.get(f"/api/documents/{doc['id']}/download", params={"inline": "true"})
    assert inline.headers["content-disposition"].startswith("inline;")

    assert user.delete(f"/api/documents/{doc['id']}").status_code == 204
    assert not path.exists()  # file removed from disk
    assert user.get(f"/api/documents/{doc['id']}").status_code == 404
    assert user.get(f"/api/documents/{doc['id']}/download").status_code == 404


@requires_db
def test_title_defaults_to_filename_and_unicode_names_download_safely(user):
    doc = upload(user, TXT, "नागरिकता notes.txt", category="identity").json()
    assert doc["title"] == "नागरिकता notes"
    response = user.get(f"/api/documents/{doc['id']}/download")
    assert "filename*=UTF-8''" in response.headers["content-disposition"]
    assert 'filename="notes.txt"' in response.headers["content-disposition"]  # trimmed ASCII fallback
    only_nepali = upload(user, TXT, "नागरिकता.txt", category="identity").json()
    fallback = user.get(f"/api/documents/{only_nepali['id']}/download").headers["content-disposition"]
    assert 'filename="document.txt"' in fallback
    assert response.headers["content-type"].startswith("text/plain")


@requires_db
def test_non_previewable_files_are_never_inline(user):
    doc = upload(user, ooxml("docx"), "cv.docx", category="work").json()
    assert doc["previewable"] is False
    response = user.get(f"/api/documents/{doc['id']}/download", params={"inline": "true"})
    assert response.headers["content-disposition"].startswith("attachment;")
    assert response.headers["content-security-policy"].startswith("sandbox;")


@requires_db
@pytest.mark.parametrize(
    ("data", "name", "fragment"),
    [
        (EXE, "invoice.pdf", "supported type"),
        (HTML, "page.txt", "HTML/SVG"),
        (SVG, "logo.svg", "isn't allowed"),
        (PNG, "photo.pdf", "doesn't match"),
        (b"", "empty.pdf", "empty"),
    ],
)
def test_upload_rejects_bad_files(user, data, name, fragment):
    response = upload(user, data, name)
    assert response.status_code == 422 and fragment in response.json()["detail"]
    assert user.get("/api/documents").json()["total_count"] == 0


@requires_db
def test_upload_rejects_invalid_metadata(user):
    assert upload(user, category="secret").status_code == 422
    assert upload(user, title="x" * 201).status_code == 422
    missing_file = user.post("/api/documents", data={"category": "finance"})
    assert missing_file.status_code == 422


@requires_db
def test_oversized_upload_rejected_before_reading(user, monkeypatch):
    monkeypatch.setattr(get_settings(), "document_max_bytes", 1024)
    big = b"%PDF-1.4\n" + b"0" * (200 * 1024)
    response = upload(user, big, "big.pdf")
    assert response.status_code == 413 and "too large" in response.json()["detail"]


@requires_db
def test_size_limit_enforced_while_reading(user, monkeypatch):
    # Within the Content-Length allowance (limit + multipart overhead) but over the file limit.
    monkeypatch.setattr(get_settings(), "document_max_bytes", 1024)
    response = upload(user, b"%PDF-1.4\n" + b"0" * 2000, "slightly-big.pdf")
    assert response.status_code == 413


@requires_db
def test_storage_quota(user, monkeypatch):
    monkeypatch.setattr(get_settings(), "document_quota_bytes", len(PDF) + 10)
    assert upload(user).status_code == 201
    over = upload(user, name="second.pdf")
    assert over.status_code == 413 and "storage space" in over.json()["detail"]


@requires_db
def test_documents_are_private(user):
    doc = upload(user).json()
    other = other_user()
    assert other.get("/api/documents").json()["items"] == []
    for method, url in [
        ("get", f"/api/documents/{doc['id']}"),
        ("get", f"/api/documents/{doc['id']}/download"),
        ("delete", f"/api/documents/{doc['id']}"),
    ]:
        assert getattr(other, method)(url).status_code == 404
    assert other.put(f"/api/documents/{doc['id']}", json={"title": "x", "category": "other"}).status_code == 404
    assert stored_path(doc).exists()  # untouched


@requires_db
def test_documents_require_authentication(client):
    assert client.get("/api/documents").status_code == 401
    assert upload(client).status_code == 401


@requires_db
def test_edit_metadata_search_and_filter(user):
    a = upload(user, PDF, "rent-agreement.pdf", category="property", title="Rent agreement", document_date="2026-04-14").json()
    upload(user, PNG, "citizenship.png", category="identity", title="Citizenship card", description="Front side")
    upload(user, TXT, "wifi.txt", category="personal", title="Router notes")

    edited = user.put(
        f"/api/documents/{a['id']}", json={"title": "Room rent agreement", "category": "property", "description": "Signed", "document_date": "2026-04-15"}
    ).json()
    assert edited["title"] == "Room rent agreement" and edited["document_date"] == "2026-04-15"

    titles = lambda **p: [d["title"] for d in user.get("/api/documents", params=p).json()["items"]]  # noqa: E731
    assert titles(search="rent") == ["Room rent agreement"]
    assert titles(search="front side") == ["Citizenship card"]  # description
    assert titles(search="wifi.txt") == ["Router notes"]  # original filename
    assert titles(category="identity") == ["Citizenship card"]
    assert titles(file_kind="png") == ["Citizenship card"]
    assert titles(date_from="2026-04-01", date_to="2026-04-30") == ["Room rent agreement"]
    assert titles(sort="title") == ["Citizenship card", "Room rent agreement", "Router notes"]

    listing = user.get("/api/documents").json()
    assert listing["used_bytes"] == len(PDF) + len(PNG) + len(TXT)
    assert listing["max_file_bytes"] == get_settings().document_max_bytes and ".pdf" in listing["allowed_extensions"]
