/**
 * Theme preference — pure logic.
 *
 * There are three preferences but only two themes. "system" is not a theme:
 * it is a deferral, and it has to stay one, because a user who picks it
 * expects the panel to follow their OS when the sun goes down. Collapsing it
 * to whatever the OS said at the moment of the click would silently freeze
 * that. So the stored value and the applied theme are different types, and
 * `resolveTheme` is the only bridge between them.
 *
 * Everything here is a pure function of its inputs — no `window`, no
 * `localStorage` — so the rules can be tested directly and reused by the
 * pre-paint inline script, which runs before React exists.
 */

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What actually gets applied to the document. Never "system". */
export type ResolvedTheme = "light" | "dark";

/** Shared by the store and the inline script — they must not drift. */
export const THEME_STORAGE_KEY = "cms.theme";

export const DEFAULT_PREFERENCE: ThemePreference = "system";

/** The class the resolved dark theme is keyed on (see `globals.css`). */
export const DARK_CLASS = "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/**
 * Interpret whatever came out of storage. Anything unrecognised — absent,
 * empty, left over from an older build, corrupted by another tab — falls back
 * to "system" rather than throwing. A bad byte in `localStorage` must never
 * be able to stop the panel rendering.
 */
export function readPreference(
  raw: string | null | undefined,
): ThemePreference {
  return isThemePreference(raw) ? raw : DEFAULT_PREFERENCE;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * Cycle order for the keyboard shortcut and for anywhere a single control has
 * to represent three states: light → dark → system → light.
 */
export function nextPreference(current: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(current);
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length];
}
