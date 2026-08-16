import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Small hand-rolled primitives.
 *
 * Deliberately not shadcn/ui: the surface needed here is a handful of form
 * controls, and pulling in a Radix dependency tree for that is more machinery
 * than the challenge warrants. Native elements also keep keyboard and screen
 * reader behaviour free.
 */

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white hover:bg-indigo-700 disabled:bg-indigo-300 disabled:hover:bg-indigo-300",
  secondary:
    "border border-border-subtle bg-surface text-ink hover:bg-surface-muted disabled:text-ink-muted",
  ghost: "text-ink-muted hover:bg-surface-muted hover:text-ink",
  danger:
    "bg-danger text-white hover:bg-red-800 disabled:bg-red-300 disabled:hover:bg-red-300",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-xs",
  md: "h-9 px-3.5 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------- Input */

const CONTROL_BASE =
  "w-full rounded-md border border-border-subtle bg-surface px-2.5 text-sm text-ink " +
  "placeholder:text-ink-muted focus:border-accent focus:outline-2 focus:outline-offset-0 " +
  "focus:outline-accent disabled:bg-surface-muted disabled:text-ink-muted";

export function Input({
  className,
  invalid,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        "h-9",
        invalid && "border-danger focus:border-danger focus:outline-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(CONTROL_BASE, "py-2", className)} {...props} />
  );
}

export function Select({
  className,
  invalid,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL_BASE,
        "h-9 pr-8",
        invalid && "border-danger focus:border-danger focus:outline-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Checkbox({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-4 w-4 rounded border-border-subtle text-accent",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------- Field */

export function FormField({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-ink"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- Badge */

type BadgeTone = "neutral" | "ok" | "warn" | "danger" | "accent";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-ink-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------- Card */

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border-subtle bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ Notice */

export function Notice({
  tone = "warn",
  title,
  children,
}: {
  tone?: "warn" | "danger" | "accent";
  title?: string;
  children: React.ReactNode;
}) {
  const tones = {
    warn: "border-border-subtle bg-warn-soft text-warn",
    danger: "border-border-subtle bg-danger-soft text-danger",
    accent: "border-border-subtle bg-accent-soft text-accent",
  };

  return (
    <div className={cn("rounded-lg border p-4", tones[tone])}>
      {title ? <p className="text-sm font-medium">{title}</p> : null}
      <div className="mt-1 text-sm text-ink-muted">{children}</div>
    </div>
  );
}
