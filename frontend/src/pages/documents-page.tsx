import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Download, Eye, FolderLock, Loader2, MoreHorizontal, Pencil, Search, SearchX, ShieldCheck, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { FormField } from "@/components/forms/form-field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { downloadUrl, useDocumentMutations, useDocuments, type DocumentItem, type DocumentList } from "@/features/records/api";
import { DOCUMENT_CATEGORIES, FILE_KIND, checkFile, fileKindIcon, formatBytes } from "@/features/records/constants";
import { getErrorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const metaSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200, "Use at most 200 characters."),
  category: z.enum(["identity", "education", "finance", "medical", "property", "insurance", "work", "receipts", "personal", "other"]),
  description: z.string().trim().max(2000, "Use at most 2000 characters."),
  document_date: z.string(),
});
type MetaInput = z.input<typeof metaSchema>;
type MetaValues = z.output<typeof metaSchema>;

function MetaFields({ register, errors }: { register: ReturnType<typeof useForm<MetaInput, unknown, MetaValues>>["register"]; errors: Partial<Record<keyof MetaInput, { message?: string }>> }) {
  return (
    <>
      <FormField id="doc-title" label="Title" error={errors.title?.message}>
        {(aria) => <Input {...aria} placeholder="e.g. Citizenship certificate" {...register("title")} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="doc-category" label="Category">
          {(aria) => (
            <NativeSelect {...aria} {...register("category")}>
              {Object.entries(DOCUMENT_CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="doc-date" label="Document date (optional)" hint="e.g. issue or statement date">
          {(aria) => <Input {...aria} type="date" {...register("document_date")} />}
        </FormField>
      </div>
      <FormField id="doc-description" label="Description" error={errors.description?.message}>
        {(aria) => <Textarea {...aria} rows={3} placeholder="Optional" {...register("description")} />}
      </FormField>
    </>
  );
}

function UploadDialog({ open, onOpenChange, limits }: { open: boolean; onOpenChange: (open: boolean) => void; limits?: DocumentList }) {
  const { upload } = useDocumentMutations();
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // The parent remounts this dialog (new `key`) each time it opens, so all state starts fresh.
  const { register, handleSubmit, setValue, getValues, formState: { errors } } = useForm<MetaInput, unknown, MetaValues>({
    resolver: zodResolver(metaSchema),
    defaultValues: { title: "", category: "personal", description: "", document_date: "" },
  });

  const allowed = limits?.allowed_extensions ?? [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".csv", ".docx", ".xlsx"];
  const maxBytes = limits?.max_file_bytes ?? 10 * 1024 * 1024;
  const choose = (picked: File | undefined) => {
    if (!picked) return;
    const problem = checkFile(picked, allowed, maxBytes);
    setFileError(problem);
    setFile(problem ? null : picked);
    if (!problem && !getValues("title")) setValue("title", picked.name.replace(/\.[^.]+$/, "").slice(0, 200));
  };

  const onSubmit = handleSubmit((meta) => {
    if (!file) return setFileError("Choose a file to upload.");
    upload.mutate(
      { file, meta: { ...meta, description: meta.description || null, document_date: meta.document_date || null } },
      {
        onSuccess: () => {
          toast.success("Document uploaded.");
          onOpenChange(false);
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !upload.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            {allowed.map((e) => e.slice(1).toUpperCase()).join(", ")} · up to {formatBytes(maxBytes)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {upload.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(upload.error)}</span>
            </Alert>
          )}
          <div
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
              dragging ? "border-primary bg-accent/40" : "border-input",
              fileError && "border-destructive",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choose(e.dataTransfer.files[0]);
            }}
          >
            <Upload className="size-6 text-muted-foreground" aria-hidden />
            {file ? (
              <p className="text-sm">
                <span className="font-medium">{file.name}</span> <span className="text-muted-foreground">({formatBytes(file.size)})</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Drag a file here, or</p>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              {file ? "Choose another file" : "Choose file"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              aria-label="File"
              accept={allowed.join(",")}
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {fileError && (
              <p className="text-xs font-medium text-destructive" role="alert">
                {fileError}
              </p>
            )}
          </div>
          <MetaFields register={register} errors={errors} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={upload.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={upload.isPending}>
              {upload.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ doc, onOpenChange }: { doc: DocumentItem | null; onOpenChange: (open: boolean) => void }) {
  const { update } = useDocumentMutations();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<MetaInput, unknown, MetaValues>({ resolver: zodResolver(metaSchema) });
  React.useEffect(() => {
    if (doc) {
      reset({ title: doc.title, category: doc.category, description: doc.description ?? "", document_date: doc.document_date ?? "" });
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  const onSubmit = handleSubmit((meta) =>
    doc &&
    update.mutate(
      { id: doc.id, meta: { ...meta, description: meta.description || null, document_date: meta.document_date || null } },
      {
        onSuccess: () => {
          toast.success("Details saved.");
          onOpenChange(false);
        },
      },
    ),
  );
  return (
    <Dialog open={doc !== null} onOpenChange={(next) => !update.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit document details</DialogTitle>
          <DialogDescription>{doc?.original_filename}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {update.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(update.error)}</span>
            </Alert>
          )}
          <MetaFields register={register} errors={errors} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FileKindIcon({ kind }: { kind: string }) {
  return React.createElement(fileKindIcon(kind), { className: "size-5", "aria-hidden": true });
}

function DocumentRow({ doc, onEdit, onDelete }: { doc: DocumentItem; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <FileKindIcon kind={doc.file_kind} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate font-medium">{doc.title}</span>
          <Badge variant="secondary">{DOCUMENT_CATEGORIES[doc.category]}</Badge>
        </div>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span className="truncate">{doc.original_filename}</span>
          <span aria-hidden>·</span>
          <span>
            {FILE_KIND[doc.file_kind]?.label ?? doc.file_kind} · {formatBytes(doc.size_bytes)}
          </span>
          {doc.document_date && (
            <>
              <span aria-hidden>·</span>
              <span>Dated {formatDate(doc.document_date)}</span>
            </>
          )}
        </p>
        {doc.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{doc.description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" asChild>
          <a href={downloadUrl(doc.id)} download aria-label={`Download ${doc.title}`}>
            <Download />
          </a>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${doc.title}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {doc.previewable && (
              <DropdownMenuItem asChild>
                <a href={downloadUrl(doc.id, true)} target="_blank" rel="noopener noreferrer">
                  <Eye /> View
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <a href={downloadUrl(doc.id)} download>
                <Download /> Download
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit details
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-destructive data-[highlighted]:text-destructive">
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function DocumentsPage() {
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [fileKind, setFileKind] = React.useState("");
  const [sort, setSort] = React.useState("newest");
  const [uploading, setUploading] = React.useState(false);
  const [uploadKey, setUploadKey] = React.useState(0);
  const openUpload = () => {
    setUploadKey((k) => k + 1);
    setUploading(true);
  };
  const [editing, setEditing] = React.useState<DocumentItem | null>(null);
  const [deleting, setDeleting] = React.useState<DocumentItem | null>(null);
  const { data, isPending, isError, error, refetch } = useDocuments({ search: debounced || undefined, category: category || undefined, file_kind: fileKind || undefined, sort });
  const { remove } = useDocumentMutations();

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const filtered = Boolean(debounced || category || fileKind);
  const usedPercent = data ? Math.round((data.used_bytes / data.quota_bytes) * 1000) / 10 : 0;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Documents"
        description="Private files like certificates, statements and receipts. Only you can open them."
        actions={
          <Button onClick={openUpload}>
            <Upload aria-hidden /> Upload
          </Button>
        }
      />

      {data && (
        <Card className="grid gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4 text-success" aria-hidden /> Private storage
            </span>
            <span className="text-muted-foreground">
              {formatBytes(data.used_bytes)} of {formatBytes(data.quota_bytes)} used
            </span>
          </div>
          <Progress value={usedPercent} label={`${usedPercent}% of document storage used`} tone={usedPercent >= 90 ? "destructive" : "default"} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]" role="search" aria-label="Filter documents">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search documents" placeholder="Search title, description, file name…" className="pl-9" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <NativeSelect aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(DOCUMENT_CATEGORIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="File type" value={fileKind} onChange={(e) => setFileKind(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(FILE_KIND).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">Title A–Z</option>
          <option value="document_date">Document date</option>
          <option value="largest">Largest first</option>
        </NativeSelect>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span>Couldn't load documents. {getErrorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : isPending ? (
        <div className="grid gap-2" aria-label="Loading documents">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No matching documents" description="Try a different search or filter." />
        ) : (
          <EmptyState icon={FolderLock} title="No documents yet" description="Upload certificates, bank statements, receipts and other private files.">
            <Button onClick={openUpload}>
              <Upload aria-hidden /> Upload a document
            </Button>
          </EmptyState>
        )
      ) : (
        <ul className="grid grid-cols-1 gap-2" aria-label="Documents">
          {data.items.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} onEdit={() => setEditing(doc)} onDelete={() => setDeleting(doc)} />
          ))}
        </ul>
      )}

      <UploadDialog key={uploadKey} open={uploading} onOpenChange={setUploading} limits={data} />
      <EditDialog doc={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete “${deleting?.title}”?`}
        description="The file will be permanently removed from storage. This can't be undone."
        confirmLabel="Delete document"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Document deleted.");
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
