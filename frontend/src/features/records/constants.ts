import { File, FileImage, FileSpreadsheet, FileText, type LucideIcon } from "lucide-react";
import type { DocumentCategory, NoteCategory } from "./api";

export const NOTE_CATEGORIES: Record<NoteCategory, { label: string; className: string }> = {
  personal: { label: "Personal", className: "bg-chart-1/15 text-foreground" },
  work: { label: "Work", className: "bg-chart-5/15 text-foreground" },
  education: { label: "Education", className: "bg-chart-2/15 text-foreground" },
  finance: { label: "Finance", className: "bg-chart-3/20 text-foreground" },
  ideas: { label: "Ideas", className: "bg-chart-4/15 text-foreground" },
  important: { label: "Important", className: "bg-destructive/15 text-foreground" },
  other: { label: "Other", className: "bg-muted text-foreground" },
};

export const DOCUMENT_CATEGORIES: Record<DocumentCategory, string> = {
  identity: "Identity",
  education: "Education",
  finance: "Finance",
  medical: "Medical",
  property: "Property",
  insurance: "Insurance",
  work: "Work",
  receipts: "Receipts",
  personal: "Personal",
  other: "Other",
};

export const FILE_KIND: Record<string, { label: string; icon: LucideIcon }> = {
  pdf: { label: "PDF", icon: FileText },
  png: { label: "PNG", icon: FileImage },
  jpeg: { label: "JPEG", icon: FileImage },
  webp: { label: "WebP", icon: FileImage },
  txt: { label: "Text", icon: FileText },
  csv: { label: "CSV", icon: FileSpreadsheet },
  docx: { label: "Word", icon: FileText },
  xlsx: { label: "Excel", icon: FileSpreadsheet },
};

export const fileKindIcon = (kind: string) => FILE_KIND[kind]?.icon ?? File;

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** "Bank, #nic asia, bank" -> ["bank", "nic-asia"] (mirrors the server's normalisation). */
export function parseTags(input: string): string[] {
  const tags = input
    .split(",")
    .map((t) => t.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean);
  return Array.from(new Set(tags)).sort();
}

/** Client-side pre-check for a friendly early message; the server re-validates by content. */
export function checkFile(file: File, allowed: string[], maxBytes: number): string | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!allowed.includes(ext)) return `This file type isn't allowed. Use ${allowed.join(", ")}.`;
  if (file.size === 0) return "The file is empty.";
  if (file.size > maxBytes) return `File is too large. The limit is ${formatBytes(maxBytes)}.`;
  return null;
}
