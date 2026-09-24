import * as React from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getErrorMessage } from "@/lib/api";
import { useCategories, useCategoryMutations, type Category, type LedgerKind } from "./api";

function validateName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name.";
  if (trimmed.length > 50) return "Use at most 50 characters.";
  return null;
}

/** Add, rename and delete custom categories. Built-in ones are listed read-only. */
export function CategoryManagerDialog({ kind, open, onOpenChange }: { kind: LedgerKind; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: categories } = useCategories(kind);
  const { create, rename, remove } = useCategoryMutations(kind);
  const [newName, setNewName] = React.useState("");
  const [newError, setNewError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = React.useState<Category | null>(null);

  const custom = categories?.filter((c) => !c.is_system) ?? [];
  const builtIn = categories?.filter((c) => c.is_system) ?? [];

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validateName(newName);
    if (problem) return setNewError(problem);
    create.mutate(newName.trim(), {
      onSuccess: (category) => {
        toast.success(`Category "${category.name}" added.`);
        setNewName("");
        setNewError(null);
      },
      onError: (error) => setNewError(getErrorMessage(error)),
    });
  };

  const saveRename = () => {
    if (!editing) return;
    const problem = validateName(editing.name);
    if (problem) return toast.error(problem);
    rename.mutate(
      { id: editing.id, name: editing.name.trim() },
      {
        onSuccess: () => {
          toast.success("Category renamed.");
          setEditing(null);
        },
        onError: (error) => toast.error(getErrorMessage(error)),
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage {kind} categories</DialogTitle>
            <DialogDescription>Add your own categories. Built-in ones can't be changed.</DialogDescription>
          </DialogHeader>

          <form onSubmit={add} noValidate className="grid gap-1.5">
            <label htmlFor={`${kind}-new-category`} className="text-sm font-medium">
              New category
            </label>
            <div className="flex gap-2">
              <Input
                id={`${kind}-new-category`}
                value={newName}
                maxLength={50}
                placeholder="e.g. Pets"
                aria-invalid={Boolean(newError)}
                aria-describedby={newError ? `${kind}-new-category-error` : undefined}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNewError(null);
                }}
              />
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
                Add
              </Button>
            </div>
            {newError && (
              <p id={`${kind}-new-category-error`} className="text-xs font-medium text-destructive">
                {newError}
              </p>
            )}
          </form>

          <section aria-labelledby={`${kind}-custom-heading`} className="grid gap-2">
            <h3 id={`${kind}-custom-heading`} className="text-sm font-medium">
              Your categories
            </h3>
            {custom.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">No custom categories yet.</p>
            ) : (
              <ul className="grid gap-1.5">
                {custom.map((category) => (
                  <li key={category.id} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
                    {editing?.id === category.id ? (
                      <>
                        <Input
                          aria-label={`New name for ${category.name}`}
                          value={editing.name}
                          maxLength={50}
                          className="h-8"
                          autoFocus
                          onChange={(e) => setEditing({ id: category.id, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              saveRename();
                            }
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setEditing(null);
                            }
                          }}
                        />
                        <Button size="icon" variant="ghost" aria-label="Save name" onClick={saveRename} disabled={rename.isPending}>
                          <Check />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label="Cancel rename" onClick={() => setEditing(null)}>
                          <X />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-sm">{category.name}</span>
                        <Button size="icon" variant="ghost" aria-label={`Rename ${category.name}`} onClick={() => setEditing({ id: category.id, name: category.name })}>
                          <Pencil />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={`Delete ${category.name}`} onClick={() => setDeleting(category)}>
                          <Trash2 className="text-destructive" />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby={`${kind}-builtin-heading`} className="grid gap-2">
            <h3 id={`${kind}-builtin-heading`} className="text-sm font-medium">
              Built-in
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {builtIn.map((category) => (
                <Badge key={category.id} variant="secondary">
                  {category.name}
                </Badge>
              ))}
            </div>
          </section>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="This can't be undone. Categories that are still used by records can't be deleted."
        confirmLabel="Delete category"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Category deleted.");
              setDeleting(null);
            },
            onError: (error) => {
              toast.error(getErrorMessage(error));
              setDeleting(null);
            },
          })
        }
      />
    </>
  );
}
