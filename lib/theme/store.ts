"use client";

import { useSyncExternalStore } from "react";

import {
  DARK_CLASS,
  DEFAULT_PREFERENCE,
  readPreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "./preference";

/**
 * Theme store.
 *
 * The state this tracks — `localStorage` and `prefers-color-scheme` — lives
 * outside React and can change without React knowing: another tab writes the
 * key, the OS flips to dark at sunset. `useSyncExternalStore` is the API for
 * exactly that, and it is used here for a second reason as well: it is the
 * one hook that handles the hydration case correctly. The server cannot know
 * the preference, so `getServerSnapshot` returns the default; React then
 * re-reads the client snapshot after hydrating and re-renders if it differs,
 * with no mismatch warning and — importantly — no `setState` inside an
 * effect, which is the pattern this codebase has had to remove three times.
 *
 * Snapshots are primitives (a string, a boolean) rather than an object, so
 * there is no cached-object dance to get right: `Object.is` on a string is
 * always stable.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let preference: ThemePreference = DEFAULT_PREFERENCE;
let systemPrefersDark = false;
let initialised = false;

const MEDIA_QUERY = "(prefers-color-scheme: dark)";

let mediaQueryList: MediaQueryList | null = null;

/**
 * `matchMedia()` returns a *new* object on every call. Attaching a listener
 * to a throwaway one silently stops working — nothing holds a reference, so
 * the browser is free to collect it — and `removeEventListener` on a
 * different instance is a no-op, which leaks. Both were observed: the panel
 * ignored the OS switching to dark while the preference was "system". One
 * instance, kept here.
 */
function media(): MediaQueryList {
  mediaQueryList ??= window.matchMedia(MEDIA_QUERY);
  return mediaQueryList;
}

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Read the environment once, lazily. Called from `getSnapshot`, which React
 * may invoke many times per render — hence the guard, so `localStorage` is
 * touched once rather than on every read.
 */
function initialise() {
  if (initialised || typeof window === "undefined") return;
  initialised = true;

  try {
    preference = readPreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be unavailable (privacy mode). The default still works;
    // the choice simply will not survive a reload.
  }
  systemPrefersDark = media().matches;
}

/** Push the resolved theme onto `<html>`. The CSS does the rest. */
function apply() {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(preference, systemPrefersDark);
  document.documentElement.classList.toggle(DARK_CLASS, resolved === "dark");
}

function handleSystemChange(event: MediaQueryListEvent) {
  systemPrefersDark = event.matches;
  // Only changes the paint while the preference is "system", but the flag is
  // tracked regardless so the toggle can label that option honestly.
  apply();
  emit();
}

/**
 * Another tab changed the preference. `storage` only fires in *other*
 * documents, so this cannot loop back on the tab that made the change.
 */
function handleStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
  try {
    preference = readPreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return;
  }
  apply();
  emit();
}

function subscribe(listener: Listener): () => void {
  initialise();
  if (listeners.size === 0 && typeof window !== "undefined") {
    media().addEventListener("change", handleSystemChange);
    window.addEventListener("storage", handleStorage);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      media().removeEventListener("change", handleSystemChange);
      window.removeEventListener("storage", handleStorage);
    }
  };
}

function getPreferenceSnapshot(): ThemePreference {
  initialise();
  return preference;
}

function getSystemSnapshot(): boolean {
  initialise();
  return systemPrefersDark;
}

const getDefaultPreference = () => DEFAULT_PREFERENCE;
const getFalse = () => false;

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Not persistable — apply it anyway for this session.
  }
  apply();
  emit();
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    subscribe,
    getPreferenceSnapshot,
    getDefaultPreference,
  );
}

export function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(subscribe, getSystemSnapshot, getFalse);
}

/** What is actually on screen right now. */
export function useResolvedTheme(): ResolvedTheme {
  return resolveTheme(useThemePreference(), useSystemPrefersDark());
}
