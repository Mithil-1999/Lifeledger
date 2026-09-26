import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// --- Notes ------------------------------------------------------------------------------------------------

export type NoteCategory = "personal" | "work" | "education" | "finance" | "ideas" | "important" | "other";
export type NoteView = "active" | "archived" | "all";

export interface Note {
  id: string;
  title: string;
  content: string; // plain text: always rendered as text, never as HTML
  category: NoteCategory;
  tags: string[];
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface NoteInput {
  title: string;
  content: string;
  category: NoteCategory;
  tags: string[];
  is_pinned: boolean;
  is_archived: boolean;
}

export interface NoteList {
  view: NoteView;
  items: Note[];
  counts: { active: number; archived: number; pinned: number };
}

export interface NoteFilters {
  search?: string;
  category?: string;
  tag?: string;
}

function qs(params: Record<string, string | undefined>) {
  const search = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const useNotes = (view: NoteView, filters: NoteFilters) =>
  useQuery({
    queryKey: ["notes", "list", view, filters],
    queryFn: () => apiFetch<NoteList>(`/api/notes${qs({ view, ...filters })}`),
    placeholderData: keepPreviousData,
  });

export const useNoteTags = () =>
  useQuery({ queryKey: ["notes", "tags"], queryFn: () => apiFetch<{ tag: string; count: number }[]>("/api/notes/tags") });

export function useNoteMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notes"] });
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: NoteInput }) =>
        apiFetch<Note>(id ? `/api/notes/${id}` : "/api/notes", { method: id ? "PUT" : "POST", body: input }),
      onSuccess: invalidate,
    }),
    flags: useMutation({
      mutationFn: ({ id, ...flags }: { id: string; is_pinned?: boolean; is_archived?: boolean }) =>
        apiFetch<Note>(`/api/notes/${id}`, { method: "PATCH", body: flags }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/notes/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  };
}

// --- Documents ----------------------------------------------------------------------------------------------

export type DocumentCategory =
  | "identity"
  | "education"
  | "finance"
  | "medical"
  | "property"
  | "insurance"
  | "work"
  | "receipts"
  | "personal"
  | "other";

export interface DocumentItem {
  id: string;
  title: string;
  category: DocumentCategory;
  description: string | null;
  document_date: string | null;
  original_filename: string;
  content_type: string;
  file_kind: string;
  size_bytes: number;
  sha256: string;
  previewable: boolean;
  created_at: string;
  updated_at: string;
}

export interface DocumentList {
  items: DocumentItem[];
  total_count: number;
  used_bytes: number;
  quota_bytes: number;
  max_file_bytes: number;
  allowed_extensions: string[];
}

export interface DocumentFilters {
  search?: string;
  category?: string;
  file_kind?: string;
  sort?: string;
}

export interface DocumentMeta {
  title: string;
  category: DocumentCategory;
  description: string | null;
  document_date: string | null;
}

export const useDocuments = (filters: DocumentFilters) =>
  useQuery({
    queryKey: ["documents", filters],
    queryFn: () => apiFetch<DocumentList>(`/api/documents${qs({ ...filters })}`),
    placeholderData: keepPreviousData,
  });

/** Same-origin URL; the session cookie authorizes it, so it never works for anyone else. */
export const downloadUrl = (id: string, inline = false) => `/api/documents/${id}/download${inline ? "?inline=true" : ""}`;

export function useDocumentMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["documents"] });
  return {
    upload: useMutation({
      mutationFn: ({ file, meta }: { file: File; meta: DocumentMeta }) => {
        const form = new FormData();
        form.append("file", file);
        form.append("title", meta.title);
        form.append("category", meta.category);
        if (meta.description) form.append("description", meta.description);
        if (meta.document_date) form.append("document_date", meta.document_date);
        return apiFetch<DocumentItem>("/api/documents", { method: "POST", body: form });
      },
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, meta }: { id: string; meta: DocumentMeta }) =>
        apiFetch<DocumentItem>(`/api/documents/${id}`, { method: "PUT", body: meta }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/api/documents/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  };
}
