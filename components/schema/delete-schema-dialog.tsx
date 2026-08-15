"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button, Input, Notice } from "@/components/ui";
import { deleteSchema } from "@/lib/actions/schemas";
import type { SchemaUsage } from "@/lib/queries";

/**
 * Delete confirmation (PRD A4).
 *
 * Two guards: incoming references from other schemas block the delete
 * outright (the DB enforces this too, with `on delete restrict`), and
 * deleting a type that holds entries requires typing its API ID. A native
 * <dialog> gives focus trapping and Escape for free.
 */
export function DeleteSchemaDialog({
  schemaId,
  schemaName,
  apiId,
  usage,
}: {
  schemaId: string;
  schemaName: string;
  apiId: string;
  usage: SchemaUsage;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const externalReferrers = usage.referencedBy.filter((r) => !r.isSelf);
  const isBlocked = externalReferrers.length > 0;
  const needsTypedConfirmation = usage.entryCount > 0;
  const canDelete =
    !isBlocked && (!needsTypedConfirmation || confirmation === apiId);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteSchema(schemaId, apiId);
      if (!result.ok) {
        setError(result.error ?? "Could not delete this content type.");
        return;
      }
      setOpen(false);
      router.push(result.redirectTo ?? "/schemas");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="text-danger hover:bg-danger-soft hover:text-danger"
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border-subtle bg-surface p-0 backdrop:bg-black/40"
      >
        <div className="border-b border-border-subtle px-5 py-3.5">
          <h2 className="text-sm font-semibold text-ink">
            Delete “{schemaName}”?
          </h2>
        </div>

        <div className="space-y-4 px-5 py-4">
          {isBlocked ? (
            <Notice tone="danger" title="Blocked by incoming references">
              <ul className="mt-1 space-y-1">
                {externalReferrers.map((ref) => (
                  <li key={`${ref.schemaId}-${ref.fieldKey}`}>
                    <span className="font-medium text-ink">
                      {ref.schemaName}
                    </span>
                    {" · "}
                    <code className="font-mono text-xs">{ref.fieldKey}</code>
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Remove {externalReferrers.length === 1 ? "that field" : "those fields"}{" "}
                first, or point {externalReferrers.length === 1 ? "it" : "them"}{" "}
                at another content type.
              </p>
            </Notice>
          ) : (
            <>
              <p className="text-sm text-ink-muted">
                This permanently deletes the content type, its field
                definitions
                {usage.entryCount > 0 ? (
                  <>
                    {" "}
                    and{" "}
                    <span className="font-medium text-ink">
                      {usage.entryCount} entr
                      {usage.entryCount === 1 ? "y" : "ies"}
                    </span>
                  </>
                ) : null}
                . It cannot be undone.
              </p>

              {usage.referencedBy.some((r) => r.isSelf) ? (
                <p className="text-sm text-ink-muted">
                  Its self-reference fields are removed along with it.
                </p>
              ) : null}

              {needsTypedConfirmation ? (
                <div className="space-y-1.5">
                  <label
                    htmlFor="confirm-api-id"
                    className="block text-sm text-ink"
                  >
                    Type <code className="font-mono text-xs">{apiId}</code> to
                    confirm
                  </label>
                  <Input
                    id="confirm-api-id"
                    value={confirmation}
                    className="font-mono text-xs"
                    autoComplete="off"
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </div>
              ) : null}
            </>
          )}

          {error ? <Notice tone="danger">{error}</Notice> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!canDelete || pending}
            onClick={handleDelete}
          >
            {pending ? "Deleting…" : "Delete content type"}
          </Button>
        </div>
      </dialog>
    </>
  );
}
