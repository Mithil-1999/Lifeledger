import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Archive, ArchiveRestore, Hash, Loader2, MoreHorizontal, NotebookPen, Pencil, Pin, PinOff, Plus, Search, SearchX, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { FormField } from "@/components/forms/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useNoteMutations, useNoteTags, useNotes, type Note, type NoteView } from "@/features/records/api";
import { NOTE_CATEGORIES, parseTags } from "@/features/records/constants";
import { getErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const noteSchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200, "Use at most 200 characters."),
  content: z.string().max(100_000, "Notes can be at most 100,000 characters."),
  category: z.enum(["personal", "work", "education", "finance", "ideas", "important", "other"]),
  tags: z
    .string()
    .transform(parseTags)
    .refine((tags) => tags.every((t) => /^[\p{L}\p{M}\p{N}_-]{1,30}$/u.test(t)), "Tags use letters, numbers, - and _ (max 30 characters).")
    .refine((tags) => tags.length <= 20, "Use at most 20 tags."),
  is_pinned: z.boolean(),
});
type NoteFormInput = z.input<typeof noteSchema>;
type NoteFormValues = z.output<typeof noteSchema>;

function NoteEditor({ open, onOpenChange, note }: { open: boolean; onOpenChange: (open: boolean) => void; note: Note | null }) {
  const { save } = useNoteMutations();
  const defaults = React.useCallback(
    (): NoteFormInput => ({
      title: note?.title ?? "",
      content: note?.content ?? "",
      category: note?.category ?? "personal",
      tags: note?.tags.join(", ") ?? "",
      is_pinned: note?.is_pinned ?? false,
    }),
    [note],
  );
  const { register, handleSubmit, reset, formState: { errors } } = useForm<NoteFormInput, unknown, NoteFormValues>({
    resolver: zodResolver(noteSchema),
    defaultValues: defaults(),
  });
  React.useEffect(() => {
    if (open) {
      reset(defaults());
      save.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults]);

  const onSubmit = handleSubmit((v) =>
    save.mutate(
      { id: note?.id, input: { ...v, is_archived: note?.is_archived ?? false, is_pinned: note?.is_archived ? false : v.is_pinned } },
      {
        onSuccess: () => {
          toast.success(note ? "Note saved." : "Note created.");
          onOpenChange(false);
        },
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{note ? "Edit note" : "New note"}</DialogTitle>
          <DialogDescription>Notes are private to your account and saved as plain text.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {save.isError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <span>{getErrorMessage(save.error)}</span>
            </Alert>
          )}
          <FormField id="note-title" label="Title" error={errors.title?.message}>
            {(aria) => <Input {...aria} autoFocus placeholder="e.g. Exam timetable" {...register("title")} />}
          </FormField>
          <FormField id="note-content" label="Note" error={errors.content?.message}>
            {(aria) => <Textarea {...aria} rows={10} className="font-[inherit]" placeholder="Write anything…" {...register("content")} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="note-category" label="Category">
              {(aria) => (
                <NativeSelect {...aria} {...register("category")}>
                  {Object.entries(NOTE_CATEGORIES).map(([value, { label }]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField id="note-tags" label="Tags" error={errors.tags?.message} hint="Comma-separated, e.g. exam, tu">
              {(aria) => <Input {...aria} placeholder="exam, tu" autoCapitalize="none" {...register("tags")} />}
            </FormField>
          </div>
          {!note?.is_archived && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" {...register("is_pinned")} />
              Pin to the top
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {note ? "Save note" : "Create note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const updatedFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function NoteCard({ note, onOpen, onDelete, onTag }: { note: Note; onOpen: () => void; onDelete: () => void; onTag: (tag: string) => void }) {
  const { flags } = useNoteMutations();
  const category = NOTE_CATEGORIES[note.category];
  const toggle = (next: { is_pinned?: boolean; is_archived?: boolean }, message: string) =>
    flags.mutate({ id: note.id, ...next }, { onSuccess: () => toast.success(message), onError: (e) => toast.error(getErrorMessage(e)) });

  return (
    <Card className={cn("flex h-full min-w-0 flex-col gap-2 p-4", note.is_pinned && "border-primary/40")}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <h3 className="flex items-center gap-1.5 font-semibold">
            {note.is_pinned && <Pin className="size-3.5 shrink-0 text-primary" aria-label="Pinned" />}
            <span className="truncate">{note.title}</span>
          </h3>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="-mr-2 -mt-1" aria-label={`Actions for ${note.title}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpen}>
              <Pencil /> Edit
            </DropdownMenuItem>
            {!note.is_archived && (
              <DropdownMenuItem onSelect={() => toggle({ is_pinned: !note.is_pinned }, note.is_pinned ? "Unpinned." : "Pinned.")}>
                {note.is_pinned ? <PinOff /> : <Pin />} {note.is_pinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => toggle({ is_archived: !note.is_archived }, note.is_archived ? "Restored from archive." : "Archived.")}>
              {note.is_archived ? <ArchiveRestore /> : <Archive />} {note.is_archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-destructive data-[highlighted]:text-destructive">
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Plain text only: React escapes it, and whitespace/newlines are preserved. */}
      {note.content && (
        <button type="button" onClick={onOpen} className="text-left">
          <p className="line-clamp-6 whitespace-pre-wrap break-words text-sm text-muted-foreground">{note.content}</p>
        </button>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", category.className)}>{category.label}</span>
        {note.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onTag(tag)}
            className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label={`Filter by tag ${tag}`}
          >
            #{tag}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">{updatedFormat.format(new Date(note.updated_at))}</span>
      </div>
    </Card>
  );
}

export function NotesPage() {
  const [view, setView] = React.useState<NoteView>("active");
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [tag, setTag] = React.useState("");
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Note | null>(null);
  const [deleting, setDeleting] = React.useState<Note | null>(null);
  const { data, isPending, isError, error, refetch } = useNotes(view, { search: debounced || undefined, category: category || undefined, tag: tag || undefined });
  const { data: tags } = useNoteTags();
  const { remove } = useNoteMutations();

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const filtered = Boolean(debounced || category || tag);
  const openNote = (note: Note | null) => {
    setEditing(note);
    setEditorOpen(true);
  };
  const pinned = data?.items.filter((n) => n.is_pinned) ?? [];
  const others = data?.items.filter((n) => !n.is_pinned) ?? [];

  const grid = (notes: Note[], label: string) => (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={label}>
      {notes.map((note) => (
        <li key={note.id} className="min-w-0">
          <NoteCard note={note} onOpen={() => openNote(note)} onDelete={() => setDeleting(note)} onTag={setTag} />
        </li>
      ))}
    </ul>
  );

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Notes"
        description="Private notes, ideas and personal records."
        actions={
          <Button onClick={() => openNote(null)}>
            <Plus aria-hidden /> New note
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={view} onValueChange={(v) => setView(v as NoteView)}>
            <TabsList aria-label="Note views">
              <TabsTrigger value="active">
                Notes {data && <span className="tabular-nums text-muted-foreground">{data.counts.active}</span>}
              </TabsTrigger>
              <TabsTrigger value="archived">
                Archived {data && <span className="tabular-nums text-muted-foreground">{data.counts.archived}</span>}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {tag && (
            <Button variant="outline" size="sm" onClick={() => setTag("")}>
              <Hash aria-hidden /> {tag} <X aria-label="Clear tag filter" />
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]" role="search" aria-label="Filter notes">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" aria-label="Search notes" placeholder="Search notes and tags…" className="pl-9" value={search} maxLength={100} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <NativeSelect aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {Object.entries(NOTE_CATEGORIES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {tags?.map((t) => (
              <option key={t.tag} value={t.tag}>
                #{t.tag} ({t.count})
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <span>Couldn't load notes. {getErrorMessage(error)}</span>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Alert>
      ) : isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading notes">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX} title="No matching notes" description="Try a different search, category or tag." />
        ) : view === "archived" ? (
          <EmptyState icon={Archive} title="No archived notes" description="Archived notes are kept here, out of your way." />
        ) : (
          <EmptyState icon={NotebookPen} title="No notes yet" description="Write down ideas, records, or anything worth keeping.">
            <Button onClick={() => openNote(null)}>
              <Plus aria-hidden /> New note
            </Button>
          </EmptyState>
        )
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {pinned.length > 0 && (
            <section aria-labelledby="pinned-heading" className="grid gap-2">
              <h2 id="pinned-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pinned
              </h2>
              {grid(pinned, "Pinned notes")}
            </section>
          )}
          {others.length > 0 && (
            <section aria-labelledby="others-heading" className="grid gap-2">
              {pinned.length > 0 && (
                <h2 id="others-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Others
                </h2>
              )}
              {grid(others, view === "archived" ? "Archived notes" : "Notes")}
            </section>
          )}
        </div>
      )}

      <NoteEditor open={editorOpen} onOpenChange={setEditorOpen} note={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete “${deleting?.title}”?`}
        description="This note will be permanently deleted. To keep it out of the way instead, archive it."
        confirmLabel="Delete note"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Note deleted.");
              setDeleting(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}
