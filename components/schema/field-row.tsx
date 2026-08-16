"use client";

import {
  Badge,
  Button,
  Checkbox,
  Input,
  Select,
} from "@/components/ui";
import { FIELD_TYPE_LABELS } from "@/lib/schema/constants";
import { toMachineName } from "@/lib/schema/validation";
import type { FieldErrors, FieldDraft } from "@/lib/schema/validation";
import { FIELD_TYPES, type FieldType } from "@/types/cms";
import type { ContentSchema } from "@/types/cms";

interface FieldRowProps {
  field: FieldDraft;
  index: number;
  total: number;
  errors: FieldErrors;
  /** Schemas a reference field may target. Includes this one (self-reference). */
  referenceTargets: ContentSchema[];
  onChange: (patch: Partial<FieldDraft>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

export function FieldRow({
  field,
  index,
  total,
  errors,
  referenceTargets,
  onChange,
  onMove,
  onRemove,
}: FieldRowProps) {
  const isNew = !field.id;
  const rowId = field.id ?? `new-${index}`;

  /**
   * Machine name follows the label only while the field is new and the user
   * has not typed a key by hand. Once saved, the key is stable — changing it
   * is a rename, which the diff treats as a data migration.
   */
  function handleLabelChange(label: string) {
    const derivedFromPrevious = toMachineName(field.label);
    const keyIsUntouched = field.key === "" || field.key === derivedFromPrevious;
    onChange(
      isNew && keyIsUntouched
        ? { label, key: toMachineName(label) }
        : { label },
    );
  }

  function handleTypeChange(type: FieldType) {
    onChange({
      type,
      // Dropping the reference type must clear the target, or the DB CHECK
      // constraint rejects the row.
      target_schema_id:
        type === "reference"
          ? (field.target_schema_id ?? referenceTargets[0]?.id ?? null)
          : null,
    });
  }

  return (
    <li className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3.5">
      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-ink-muted">
            {index + 1}
          </span>
          {isNew ? <Badge tone="accent">New</Badge> : null}
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`label-${rowId}`}
              className="mb-1 block text-xs font-medium text-ink-muted"
            >
              Label
            </label>
            <Input
              id={`label-${rowId}`}
              value={field.label}
              invalid={Boolean(errors.label)}
              placeholder="Published at"
              onChange={(e) => handleLabelChange(e.target.value)}
            />
            {errors.label ? (
              <p className="mt-1 text-xs text-danger">{errors.label}</p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor={`key-${rowId}`}
              className="mb-1 block text-xs font-medium text-ink-muted"
            >
              Field ID
            </label>
            <Input
              id={`key-${rowId}`}
              value={field.key}
              invalid={Boolean(errors.key)}
              placeholder="published_at"
              className="font-mono text-xs"
              onChange={(e) => onChange({ key: e.target.value })}
              onBlur={(e) =>
                onChange({ key: toMachineName(e.target.value) })
              }
            />
            {errors.key ? (
              <p className="mt-1 text-xs text-danger">{errors.key}</p>
            ) : (
              <p className="mt-1 text-xs text-ink-muted">
                {isNew
                  ? "Used in storage and the read API."
                  : "Changing this is a rename — data is remapped."}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={`type-${rowId}`}
              className="mb-1 block text-xs font-medium text-ink-muted"
            >
              Type
            </label>
            <Select
              id={`type-${rowId}`}
              value={field.type}
              onChange={(e) => handleTypeChange(e.target.value as FieldType)}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </div>

          {field.type === "reference" ? (
            <div>
              <label
                htmlFor={`target-${rowId}`}
                className="mb-1 block text-xs font-medium text-ink-muted"
              >
                Points at
              </label>
              <Select
                id={`target-${rowId}`}
                value={field.target_schema_id ?? ""}
                invalid={Boolean(errors.target_schema_id)}
                onChange={(e) =>
                  onChange({ target_schema_id: e.target.value || null })
                }
              >
                <option value="">Select a content type…</option>
                {referenceTargets.map((schema) => (
                  <option key={schema.id} value={schema.id}>
                    {schema.name}
                  </option>
                ))}
              </Select>
              {errors.target_schema_id ? (
                <p className="mt-1 text-xs text-danger">
                  {errors.target_schema_id}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <Checkbox
            checked={field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          Required
        </label>
      </div>

      <div className="flex flex-col items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          aria-label={`Move ${field.label || "field"} up`}
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          ↑
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          aria-label={`Move ${field.label || "field"} down`}
          disabled={index === total - 1}
          onClick={() => onMove(1)}
        >
          ↓
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          aria-label={`Remove ${field.label || "field"}`}
          className="text-danger hover:bg-danger-soft hover:text-danger"
          onClick={onRemove}
        >
          ✕
        </Button>
      </div>
    </li>
  );
}
