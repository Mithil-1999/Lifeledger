"""Notes and documents. All routes require a signed-in user and only touch that user's data."""

import uuid
from datetime import date
from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse

from app.api.deps import CurrentUser, DbSession
from app.models import DocumentCategory, NoteCategory
from app.schemas.records import DocumentList, DocumentOut, DocumentUpdate, NoteFlags, NoteIn, NoteList, NoteOut, NoteView, TagCount
from app.services import documents as document_service
from app.services import notes as note_service
from app.services.file_validation import KINDS

router = APIRouter()


def _http(exc: Exception) -> HTTPException:
    return HTTPException(status_code=getattr(exc, "status_code", 400), detail=str(exc))


# --- Notes ----------------------------------------------------------------------------------------------------------


@router.get("/notes", response_model=NoteList, tags=["notes"])
def list_notes(
    user: CurrentUser,
    db: DbSession,
    view: NoteView = "active",
    search: Annotated[str | None, Query(max_length=100)] = None,
    category: NoteCategory | None = None,
    tag: Annotated[str | None, Query(max_length=30)] = None,
) -> Any:
    return note_service.list_notes(db, user.id, view, search=search or None, category=category.value if category else None, tag=tag or None)


@router.get("/notes/tags", response_model=list[TagCount], tags=["notes"])
def note_tags(user: CurrentUser, db: DbSession) -> Any:
    return note_service.tag_counts(db, user.id)


@router.post("/notes", response_model=NoteOut, status_code=status.HTTP_201_CREATED, tags=["notes"])
def create_note(payload: NoteIn, user: CurrentUser, db: DbSession) -> Any:
    return note_service.create_note(db, user.id, payload.model_dump())


@router.get("/notes/{note_id}", response_model=NoteOut, tags=["notes"])
def get_note(note_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
    try:
        return note_service.get_note(db, user.id, note_id)
    except note_service.NoteError as exc:
        raise _http(exc) from None


@router.put("/notes/{note_id}", response_model=NoteOut, tags=["notes"])
def update_note(note_id: uuid.UUID, payload: NoteIn, user: CurrentUser, db: DbSession) -> Any:
    try:
        return note_service.update_note(db, user.id, note_id, payload.model_dump())
    except note_service.NoteError as exc:
        raise _http(exc) from None


@router.patch("/notes/{note_id}", response_model=NoteOut, tags=["notes"])
def set_note_flags(note_id: uuid.UUID, payload: NoteFlags, user: CurrentUser, db: DbSession) -> Any:
    """Pin/unpin and archive/unarchive without resending the whole note."""
    try:
        return note_service.set_flags(db, user.id, note_id, payload.is_pinned, payload.is_archived)
    except note_service.NoteError as exc:
        raise _http(exc) from None


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["notes"])
def delete_note(note_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    try:
        note_service.delete_note(db, user.id, note_id)
    except note_service.NoteError as exc:
        raise _http(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Documents ---------------------------------------------------------------------------------------------------------


@router.get("/documents", response_model=DocumentList, tags=["documents"])
def list_documents(
    user: CurrentUser,
    db: DbSession,
    search: Annotated[str | None, Query(max_length=100)] = None,
    category: DocumentCategory | None = None,
    file_kind: Annotated[Literal[tuple(KINDS)] | None, Query()] = None,  # type: ignore[valid-type]
    date_from: date | None = None,
    date_to: date | None = None,
    sort: Literal["newest", "oldest", "title", "document_date", "largest"] = "newest",
) -> Any:
    return document_service.list_documents(
        db,
        user.id,
        search=search or None,
        category=category.value if category else None,
        file_kind=file_kind,
        date_from=date_from,
        date_to=date_to,
        sort=sort,
    )


@router.post("/documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED, tags=["documents"])
def upload_document(
    user: CurrentUser,
    db: DbSession,
    file: Annotated[UploadFile, File(description="PDF, PNG, JPEG, WebP, TXT, CSV, DOCX or XLSX")],
    category: Annotated[DocumentCategory, Form()],
    title: Annotated[str | None, Form(max_length=200)] = None,
    description: Annotated[str | None, Form(max_length=2000)] = None,
    document_date: Annotated[date | None, Form()] = None,
) -> Any:
    try:
        doc = document_service.upload_document(
            db,
            user.id,
            stream=file.file,
            filename=file.filename,
            title=(title or "").strip() or None,
            category=category.value,
            description=(description or "").strip() or None,
            document_date=document_date,
        )
    except document_service.DocumentError as exc:
        raise _http(exc) from None
    finally:
        file.file.close()
    return document_service.to_out(doc)


@router.get("/documents/{document_id}", response_model=DocumentOut, tags=["documents"])
def get_document(document_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Any:
    try:
        return document_service.to_out(document_service.get_document(db, user.id, document_id))
    except document_service.DocumentError as exc:
        raise _http(exc) from None


@router.put("/documents/{document_id}", response_model=DocumentOut, tags=["documents"])
def update_document(document_id: uuid.UUID, payload: DocumentUpdate, user: CurrentUser, db: DbSession) -> Any:
    try:
        return document_service.to_out(document_service.update_document(db, user.id, document_id, payload.model_dump()))
    except document_service.DocumentError as exc:
        raise _http(exc) from None


@router.get("/documents/{document_id}/download", tags=["documents"])
def download_document(document_id: uuid.UUID, user: CurrentUser, db: DbSession, inline: bool = False) -> FileResponse:
    """Stream the file to its owner. Always an attachment unless `inline` is requested for a
    PDF/image, which is then served inside a CSP sandbox (no scripts, no same-origin access)."""
    try:
        doc = document_service.get_document(db, user.id, document_id)
        path = document_service.file_path(doc)
    except document_service.DocumentError as exc:
        raise _http(exc) from None
    if not path.is_file():
        raise HTTPException(status_code=410, detail="The stored file is missing.")

    show_inline = inline and KINDS[doc.file_kind].inline
    disposition = "inline" if show_inline else "attachment"
    # ASCII fallback for old clients (modern browsers use the UTF-8 filename* below).
    ascii_name = doc.original_filename.encode("ascii", "ignore").decode().replace('"', "").replace("\\", "")
    stem, dot, ext = ascii_name.rpartition(".")
    if not dot:
        stem, ext = ascii_name, ""
    stem = stem.strip(" .")
    if not stem:  # e.g. "नागरिकता.txt" -> ".txt": keep the extension, name it "document"
        stem = "document"
    ascii_name = f"{stem}.{ext}" if ext else stem
    # Images are sandboxed outright. Browsers' PDF viewers refuse to run in a sandbox, so PDFs
    # get a locked-down policy instead; with nosniff and a fixed PDF type they can't become HTML.
    csp = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'none'"
    if doc.file_kind != "pdf" or not show_inline:
        csp = "sandbox; " + csp
    headers = {
        "Content-Disposition": f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(doc.original_filename)}",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": csp,
    }
    return FileResponse(path, media_type=doc.content_type, headers=headers)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["documents"])
def delete_document(document_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    try:
        document_service.delete_document(db, user.id, document_id)
    except document_service.DocumentError as exc:
        raise _http(exc) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
