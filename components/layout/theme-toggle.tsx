"use client";

import type { ThemePreference } from "@/lib/theme/preference";
import {
  setThemePreference,
  useSystemPrefersDark,
  useThemePreference,
} from "@/lib/theme/store";
import { cn } from "@/lib/utils";

/**
 * Theme control.
 *
 * Three options rather than one switch, because "system" is a real answer and
 * a two-state switch cannot express it: the moment you click a binary toggle
 * you have opted out of ever following the OS again. Radio inputs rather than
 * buttons, for the same reason the rest of this codebase prefers native
 * elements — the group is announced as a group, exactly one option reads as
 * selected, and arrow-key navigation comes for free instead of being
 * re-implemented with `onKeyDown`.
 *
 * The inputs are visually hidden, not removed: the label styling is driven by
 * `peer-checked`, so what is painted and what is checked cannot disagree.
 */

const OPTIONS: { value: ThemePreference; label: string; icon: Icon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: SystemIcon },
];

type Icon = (props: { className?: string }) => React.ReactElement;

export function ThemeToggle() {
  const preference = useThemePreference();
  const systemPrefersDark = useSystemPrefersDark();

  return (
    <fieldset className="flex items-center gap-2">
      <legend className="sr-only">Theme</legend>

      <div className="flex gap-0.5 rounded-md border border-border-subtle p-0.5">
        {OPTIONS.map(({ value, label, icon: IconComponent }) => (
          <label
            key={value}
            title={
              value === "system"
                ? `Follow the system theme (currently ${
                    systemPrefersDark ? "dark" : "light"
                  })`
                : `${label} theme`
            }
            className="cursor-pointer"
          >
            <input
              type="radio"
              name="theme-preference"
              value={value}
              checked={preference === value}
              onChange={() => setThemePreference(value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex h-6 w-7 items-center justify-center rounded text-ink-muted transition-colors",
                /*
                 * Hover is scoped to the *unselected* options. Without
                 * `not-peer-checked`, hovering the option you already have
                 * selected repaints it in the hover colours and it reads as
                 * deselected — with three options and one always selected,
                 * that is a third of the control lying while the pointer is
                 * over it. Caught by inspecting computed styles after a
                 * click, since the pointer stays put.
                 */
                "not-peer-checked:hover:bg-surface-muted not-peer-checked:hover:text-ink",
                "peer-checked:bg-accent-soft peer-checked:text-accent",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
              )}
            >
              <IconComponent className="h-3.5 w-3.5" />
              <span className="sr-only">{label}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------- icons */

/* Inline, stroked with `currentColor` so they follow the label colour in both
   themes. Three small paths do not justify an icon dependency. */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

function SystemIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...STROKE}>
      <rect x="2.5" y="4" width="19" height="12.5" rx="1.5" />
      <path d="M8.5 20.5h7" />
    </svg>
  );
}
