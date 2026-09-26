import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentItem, Note } from "@/features/records/api";
import { checkFile, formatBytes, parseTags } from "@/features/records/constants";
import { emptyDocuments, emptyNoteList, mockApi, renderApp, sentBody } from "./utils";

afterEach(() => vi.unstubAllGlobals());

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Exam timetable",
    content: "Physics on Sunday\n<script>alert(1)</script>",
    category: "education",
    tags: ["exam", "tu"],
    is_pinned: false,
    is_archived: false,
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-25T00:00:00Z",
    ...overrides,
  };
}

function doc(overrides: Partial<DocumentItem> = {}): DocumentItem {
  return {
    id: "d1",
    title: "Citizenship certificate",
    category: "identity",
    description: "Front and back",
    document_date: "2015-03-01",
    original_filename: "citizenship.pdf",
    content_type: "application/pdf",
    file_kind: "pdf",
    size_bytes: 245_760,
    sha256: "a".repeat(64),
    previewable: true,
    created_at: "2026-09-25T00:00:00Z",
    updated_at: "2026-09-25T00:00:00Z",
    ...overrides,
  };
}

// --- Notes ------------------------------------------------------------------------------------------------

describe("notes page", () => {
  it("shows pinned notes first and renders content as plain text", async () => {
    mockApi({
      routes: {
        "GET /api/notes": {
          status: 200,
          body: { ...emptyNoteList, items: [note({ id: "p", title: "Wi-Fi password location", is_pinned: true }), note()], counts: { active: 2, archived: 1, pinned: 1 } },
        },
      },
    });
    renderApp("/notes");
    const pinned = await screen.findByRole("list", { name: "Pinned notes" });
    expect(within(pinned).getByText("Wi-Fi password location")).toBeInTheDocument();
    const others = screen.getByRole("list", { name: "Notes" });
    // The <script> is shown as text, never executed or turned into an element.
    expect(within(others).getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(document.querySelector("main script")).toBeNull();
    expect(within(others).getByRole("button", { name: "Filter by tag exam" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Archived\s*1/ })).toBeInTheDocument();
  });

  it("creates a note with normalised tags", async () => {
    const fetchMock = mockApi({ routes: { "POST /api/notes": { status: 201, body: note() } } });
    const user = userEvent.setup();
    renderApp("/notes");
    await user.click((await screen.findAllByRole("button", { name: "New note" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "New note" });
    await user.type(within(dialog).getByLabelText("Title"), "Bank details");
    await user.type(within(dialog).getByLabelText("Note"), "Branch: Kathmandu");
    await user.selectOptions(within(dialog).getByLabelText("Category"), "finance");
    await user.type(within(dialog).getByLabelText("Tags"), "#Bank, nic asia, bank");
    await user.click(within(dialog).getByLabelText("Pin to the top"));
    await user.click(within(dialog).getByRole("button", { name: "Create note" }));
    await waitFor(() =>
      expect(sentBody(fetchMock, "POST", "/api/notes")).toEqual({
        title: "Bank details",
        content: "Branch: Kathmandu",
        category: "finance",
        tags: ["bank", "nic-asia"],
        is_pinned: true,
        is_archived: false,
      }),
    );
  });

  it("validates tags", async () => {
    mockApi();
    const user = userEvent.setup();
    renderApp("/notes");
    await user.click((await screen.findAllByRole("button", { name: "New note" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "New note" });
    await user.type(within(dialog).getByLabelText("Title"), "x");
    await user.type(within(dialog).getByLabelText("Tags"), "bad!tag");
    await user.click(within(dialog).getByRole("button", { name: "Create note" }));
    expect(await within(dialog).findByText(/Tags use letters, numbers/)).toBeInTheDocument();
  });

  it("pins, archives and deletes from the menu", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/notes": { status: 200, body: { ...emptyNoteList, items: [note()], counts: { active: 1, archived: 0, pinned: 0 } } },
        "PATCH /api/notes/n1": (init) => ({ status: 200, body: note(JSON.parse(String(init.body))) }),
        "DELETE /api/notes/n1": { status: 204 },
      },
    });
    const user = userEvent.setup();
    renderApp("/notes");
    await user.click(await screen.findByRole("button", { name: "Actions for Exam timetable" }));
    await user.click(await screen.findByRole("menuitem", { name: /Pin/ }));
    await waitFor(() => expect(sentBody(fetchMock, "PATCH", "/api/notes/n1")).toEqual({ is_pinned: true }));

    await user.click(screen.getByRole("button", { name: "Actions for Exam timetable" }));
    await user.click(await screen.findByRole("menuitem", { name: /Archive/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u, i]) => u === "/api/notes/n1" && i?.method === "PATCH").map(([, i]) => JSON.parse(String(i!.body)))).toContainEqual({
        is_archived: true,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Actions for Exam timetable" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete note" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/notes/n1", expect.objectContaining({ method: "DELETE" })));
  });

  it("filters by tag, category and search", async () => {
    const fetchMock = mockApi({
      routes: { "GET /api/notes": { status: 200, body: { ...emptyNoteList, items: [note()], counts: { active: 1, archived: 0, pinned: 0 } } } },
    });
    const user = userEvent.setup();
    renderApp("/notes");
    await user.click(await screen.findByRole("button", { name: "Filter by tag exam" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "education");
    await user.type(screen.getByRole("searchbox", { name: "Search notes" }), "physics");
    await waitFor(() => {
      const last = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/notes?")).at(-1)!;
      expect(Object.fromEntries(new URL(last, "http://x").searchParams)).toEqual({ view: "active", search: "physics", category: "education", tag: "exam" });
    });
  });
});

// --- Documents ----------------------------------------------------------------------------------------------

function uploadedForm(fetchMock: ReturnType<typeof mockApi>) {
  const call = fetchMock.mock.calls.find(([u, i]) => u === "/api/documents" && i?.method === "POST");
  return call ? { form: call[1]!.body as FormData, headers: new Headers(call[1]!.headers) } : undefined;
}

describe("documents page", () => {
  it("lists documents with safe download and view links", async () => {
    mockApi({
      routes: {
        "GET /api/documents": {
          status: 200,
          body: { ...emptyDocuments, items: [doc(), doc({ id: "d2", title: "CV", file_kind: "docx", previewable: false, original_filename: "cv.docx" })], total_count: 2, used_bytes: 300_000 },
        },
      },
    });
    const user = userEvent.setup();
    renderApp("/documents");
    const items = within(await screen.findByRole("list", { name: "Documents" })).getAllByRole("listitem");
    expect(within(items[0]).getByText(/PDF · 240 KB/)).toBeInTheDocument();
    expect(within(items[0]).getByRole("link", { name: "Download Citizenship certificate" })).toHaveAttribute("href", "/api/documents/d1/download");
    expect(screen.getByText(/293 KB of 1.0 GB used/)).toBeInTheDocument();

    await user.click(within(items[0]).getByRole("button", { name: "Actions for Citizenship certificate" }));
    expect(await screen.findByRole("menuitem", { name: /View/ })).toHaveAttribute("href", "/api/documents/d1/download?inline=true");
    await user.keyboard("{Escape}");
    await user.click(within(items[1]).getByRole("button", { name: "Actions for CV" }));
    expect(screen.queryByRole("menuitem", { name: /View/ })).not.toBeInTheDocument(); // DOCX isn't previewable
  });

  it("uploads a file as multipart with the CSRF header", async () => {
    const fetchMock = mockApi({ routes: { "POST /api/documents": { status: 201, body: doc() } } });
    const user = userEvent.setup();
    renderApp("/documents");
    await user.click((await screen.findAllByRole("button", { name: /Upload/ }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Upload document" });
    const file = new File(["%PDF-1.4 test"], "Citizenship scan.pdf", { type: "application/pdf" });
    await user.upload(within(dialog).getByLabelText("File"), file);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Citizenship scan"); // prefilled from the name
    await user.selectOptions(within(dialog).getByLabelText("Category"), "identity");
    await user.type(within(dialog).getByLabelText("Document date (optional)"), "2015-03-01");
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(uploadedForm(fetchMock)).toBeDefined());
    const { form, headers } = uploadedForm(fetchMock)!;
    expect((form.get("file") as File).name).toBe("Citizenship scan.pdf");
    expect(form.get("title")).toBe("Citizenship scan");
    expect(form.get("category")).toBe("identity");
    expect(form.get("document_date")).toBe("2015-03-01");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-test-token");
    expect(headers.get("Content-Type")).toBeNull(); // browser sets the multipart boundary
    expect(await screen.findByText("Document uploaded.")).toBeInTheDocument();
  });

  it("rejects disallowed or oversized files before uploading", async () => {
    const fetchMock = mockApi({ routes: { "GET /api/documents": { status: 200, body: { ...emptyDocuments, max_file_bytes: 1024 } } } });
    const user = userEvent.setup({ applyAccept: false });
    renderApp("/documents");
    await screen.findByText(/used/);
    await user.click((await screen.findAllByRole("button", { name: /Upload/ }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Upload document" });
    await user.upload(within(dialog).getByLabelText("File"), new File(["MZ"], "setup.exe"));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("This file type isn't allowed");
    await user.upload(within(dialog).getByLabelText("File"), new File(["x".repeat(2048)], "big.pdf"));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("File is too large");
    await user.type(within(dialog).getByLabelText("Title"), "x");
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(uploadedForm(fetchMock)).toBeUndefined();
  });

  it("shows the server's validation message", async () => {
    mockApi({
      routes: { "POST /api/documents": { status: 422, body: { detail: "The file extension doesn't match its contents (looks like PNG)." } } },
    });
    const user = userEvent.setup();
    renderApp("/documents");
    await user.click((await screen.findAllByRole("button", { name: /Upload/ }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Upload document" });
    await user.upload(within(dialog).getByLabelText("File"), new File(["\x89PNG"], "photo.pdf"));
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect(await within(dialog).findByText(/doesn't match its contents/)).toBeInTheDocument();
  });

  it("edits details and deletes after confirmation", async () => {
    const fetchMock = mockApi({
      routes: {
        "GET /api/documents": { status: 200, body: { ...emptyDocuments, items: [doc()], total_count: 1 } },
        "PUT /api/documents/d1": { status: 200, body: doc({ title: "Nagarikta" }) },
        "DELETE /api/documents/d1": { status: 204 },
      },
    });
    const user = userEvent.setup();
    renderApp("/documents");
    await user.click(await screen.findByRole("button", { name: "Actions for Citizenship certificate" }));
    await user.click(await screen.findByRole("menuitem", { name: /Edit details/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit document details" });
    await user.clear(within(dialog).getByLabelText("Title"));
    await user.type(within(dialog).getByLabelText("Title"), "Nagarikta");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(sentBody(fetchMock, "PUT", "/api/documents/d1")).toEqual({
        title: "Nagarikta",
        category: "identity",
        description: "Front and back",
        document_date: "2015-03-01",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Actions for Citizenship certificate" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/documents/d1", expect.objectContaining({ method: "DELETE" })));
  });

  it("sends search and filters", async () => {
    const fetchMock = mockApi();
    const user = userEvent.setup();
    renderApp("/documents");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Category" }), "finance");
    await user.selectOptions(screen.getByRole("combobox", { name: "File type" }), "pdf");
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "title");
    await user.type(screen.getByRole("searchbox", { name: "Search documents" }), "statement");
    await waitFor(() => {
      const last = fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/documents?")).at(-1)!;
      expect(Object.fromEntries(new URL(last, "http://x").searchParams)).toEqual({ search: "statement", category: "finance", file_kind: "pdf", sort: "title" });
    });
  });
});

// --- Helpers -------------------------------------------------------------------------------------------------------

describe("helpers", () => {
  it("parses tags like the server", () => {
    expect(parseTags("#Bank, nic asia , bank,,")).toEqual(["bank", "nic-asia"]);
  });

  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
  });

  it("pre-checks files", () => {
    const allowed = [".pdf", ".png"];
    expect(checkFile(new File(["x"], "a.PDF"), allowed, 10)).toBeNull();
    expect(checkFile(new File([""], "a.pdf"), allowed, 10)).toBe("The file is empty.");
    expect(checkFile(new File(["x"], "a.svg"), allowed, 10)).toMatch(/isn't allowed/);
  });
});
