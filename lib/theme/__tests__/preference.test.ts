import { describe, expect, it } from "vitest";

import {
  DARK_CLASS,
  DEFAULT_PREFERENCE,
  isThemePreference,
  nextPreference,
  readPreference,
  resolveTheme,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../preference";
import { THEME_SCRIPT } from "../script";

describe("readPreference", () => {
  it("accepts every supported preference", () => {
    for (const value of THEME_PREFERENCES) {
      expect(readPreference(value)).toBe(value);
    }
  });

  // Storage is shared with the rest of the origin and survives deploys, so
  // anything at all can be sitting under the key.
  it.each([
    ["absent", null],
    ["undefined", undefined],
    ["empty", ""],
    ["a removed option", "sepia"],
    ["JSON from an older shape", '{"theme":"dark"}'],
    ["wrong case", "Dark"],
    ["padded", " dark "],
  ])("falls back to the default for %s", (_label, raw) => {
    expect(readPreference(raw as string | null | undefined)).toBe(
      DEFAULT_PREFERENCE,
    );
  });

  it("guards the type", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference(0)).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("applies an explicit preference regardless of the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("defers to the system only for 'system'", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("never returns 'system' — it is a preference, not a theme", () => {
    for (const preference of THEME_PREFERENCES) {
      for (const systemDark of [true, false]) {
        expect(["light", "dark"]).toContain(
          resolveTheme(preference, systemDark),
        );
      }
    }
  });
});

describe("nextPreference", () => {
  it("cycles through every option and returns to the start", () => {
    let current: ThemePreference = THEME_PREFERENCES[0];
    const seen = new Set<ThemePreference>([current]);

    for (let i = 0; i < THEME_PREFERENCES.length - 1; i += 1) {
      current = nextPreference(current);
      seen.add(current);
    }

    expect(seen.size).toBe(THEME_PREFERENCES.length);
    expect(nextPreference(current)).toBe(THEME_PREFERENCES[0]);
  });
});

/*
 * The inline script is a string, so the compiler cannot check it against the
 * constants the store uses. If the key or the class name were edited in one
 * place only, the symptom would be a theme that flashes or silently resets on
 * reload — which is exactly the failure the script exists to prevent, and it
 * would not fail any other test. Hence these.
 */
describe("THEME_SCRIPT", () => {
  it("uses the same storage key and class as the store", () => {
    expect(THEME_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_SCRIPT).toContain(JSON.stringify(DARK_CLASS));
  });

  it("knows every preference the store can persist", () => {
    for (const value of THEME_PREFERENCES) {
      expect(THEME_SCRIPT).toContain(JSON.stringify(value));
    }
  });

  it("cannot throw out of the head", () => {
    expect(THEME_SCRIPT).toContain("try{");
    expect(THEME_SCRIPT).toContain("catch(e){}");
  });

  it("is a single line, so it cannot break an inline <script>", () => {
    expect(THEME_SCRIPT).not.toContain("\n");
    expect(THEME_SCRIPT).not.toContain("</script");
  });

  it("resolves the same way as resolveTheme, for the same inputs", () => {
    // Execute the real script against a fake document/storage/matchMedia and
    // assert it agrees with the pure function. Two implementations of one
    // rule is the risk; this pins them together.
    for (const stored of [...THEME_PREFERENCES, null, "bogus"]) {
      for (const systemDark of [true, false]) {
        const classes = new Set<string>();
        const scope = {
          localStorage: { getItem: () => stored },
          window: {
            matchMedia: () => ({ matches: systemDark }),
          },
          document: {
            documentElement: {
              classList: {
                toggle: (name: string, on: boolean) => {
                  if (on) classes.add(name);
                  else classes.delete(name);
                },
              },
            },
          },
        };

        new Function(
          "localStorage",
          "window",
          "document",
          THEME_SCRIPT,
        )(scope.localStorage, scope.window, scope.document);

        const expected = resolveTheme(readPreference(stored), systemDark);
        expect(classes.has(DARK_CLASS)).toBe(expected === "dark");
      }
    }
  });
});
