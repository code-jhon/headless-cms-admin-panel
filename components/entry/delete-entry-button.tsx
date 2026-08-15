"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button, Notice } from "@/components/ui";
import { deleteEntry } from "@/lib/actions/entries";

/**
 * Delete with confirmation (PRD B4).
 *
 * A native <dialog> gives focus trapping and Escape handling for free — the
 * reason there is no Radix dependency in this project.
 */
export function DeleteEntryButton({
  schemaId,
  apiId,
  entryId,
  title,
  /** Render as a full-width button rather than a compact row action. */
  variant = "compact",
  onDeleted,
}: {
  schemaId: string;
  apiId: string;
  entryId: string;
  title: string;
  variant?: "compact" | "full";
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteEntry(schemaId, apiId, entryId);
      if (!result.ok) {
        setError(result.error ?? "Could not delete this entry.");
        return;
      }
      setOpen(false);
      onDeleted?.();
      router.push(`/content/${apiId}`);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={variant === "compact" ? "sm" : "md"}
        className="text-danger hover:bg-danger-soft hover:text-danger"
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border-subtle bg-surface p-0 backdrop:bg-black/40"
      >
        <div className="border-b border-border-subtle px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">Delete this entry?</h2>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-ink-muted">
            <span className="font-medium text-ink">{title}</span> will be
            permanently removed. This cannot be undone.
          </p>
          <p className="text-sm text-ink-muted">
            Entries in other content types that reference it are flagged as
            needing attention.
          </p>
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={handleDelete}
          >
            {pending ? "Deleting…" : "Delete entry"}
          </Button>
        </div>
      </dialog>
    </>
  );
}
