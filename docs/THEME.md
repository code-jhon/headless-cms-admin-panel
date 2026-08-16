# Dark / light theme

**Added after milestone 5** · Related: [`PRD.md`](./PRD.md) ·
[`IMPLEMENTATION_STRATEGY.md`](./IMPLEMENTATION_STRATEGY.md) ·
[`AI_WORKFLOW.md`](./AI_WORKFLOW.md)

A three-state theme control — **light**, **dark**, **system** — in the sidebar
footer. The choice persists, follows the OS when asked to, syncs across tabs,
and is applied before the first paint so there is no flash.

---

## 1. Why this was almost free

No component was recoloured. Every colour in the app was already a semantic
token — `surface`, `ink`, `ink-muted`, `accent`, `ok`, `warn`, `danger` and
their `-soft` variants — and no component named a literal colour. Adding a
theme therefore meant redefining variables, not editing ~400 utility usages.

The mechanism is one level of indirection in `app/globals.css`:

```css
@theme  { --color-ink: var(--ink); }   /* Tailwind emits var(--color-ink) */
:root   { --ink: #14161a; }            /* light */
.dark   { --ink: #e8ebf0; }            /* dark  */
```

Tailwind resolves `--color-ink` once, at build time, to a `var()` chain. The
cascade does the switching at *use* time, so toggling a class on `<html>`
repaints the whole app. `@custom-variant dark (&:where(.dark, .dark *))` keeps
the class strategy rather than the media-query one, because a user has to be
able to override their OS.

**The audit that made this true:** before writing any of it, every colour
utility in `app/`, `components/` and `lib/` was listed. Exactly six hardcoded
palette colours existed, all of them in `components/ui/index.tsx`
(`bg-indigo-700`, `bg-indigo-300`, `bg-red-800`, `bg-red-300`). They are gone.
A theme built on top of them would have had two buttons that ignored it.

## 2. Solid fills versus foreground colours

The one thing a naive inversion gets wrong.

`--accent` is used two ways: as **text** (links, badges, focus rings) and as a
**fill behind white text** (the primary button). In dark mode those pull in
opposite directions — text has to get *lighter* to stay readable, while a fill
carrying white text has to stay *dark*. One token cannot do both; whichever
way it moves, one of the two usages breaks.

So there are two families:

| Token | Role | Light | Dark |
|---|---|---|---|
| `--accent` | accent **text** on a page background | `#4f46e5` | `#a5a0f7` (lifted) |
| `--accent-solid` | fill **behind white text** | `#4f46e5` | `#4f46e5` (unchanged) |

Same split for `danger`. `Button` uses `bg-accent-solid` / `bg-danger-solid`;
everything textual keeps `text-accent` / `text-danger`.

## 3. No flash

The preference lives in `localStorage`, which the server cannot read, so the
server-rendered HTML is necessarily theme-less. Applying the class from React
would paint light for one frame — a white flash on every navigation for every
dark-mode user.

`lib/theme/script.ts` exports a small script inlined into `<head>`, which runs
synchronously before the first paint and sets the class. It is *generated from
the same constants the store uses*, so the storage key and class name cannot
drift apart, and it is wrapped in `try/catch` because `localStorage` throws
outright in some privacy modes — a theme preference is not worth a blank page.

`<html>` carries `suppressHydrationWarning`, scoped to that element only: the
script mutating its class list is the one expected server/client difference.

## 4. Why `useSyncExternalStore`

The state being tracked lives outside React and changes without React
knowing — another tab writes the key, the OS flips to dark at sunset. That is
what `useSyncExternalStore` is for.

It was also the hook that avoided a trap this codebase has hit before. The
obvious implementation — `useState` seeded with a default, then a `useEffect`
that reads `localStorage` and calls `setState` — is exactly the
`react-hooks/set-state-in-effect` violation ESLint has rejected three times
here. `useSyncExternalStore` handles the same problem natively:
`getServerSnapshot` returns the default, React re-reads the client snapshot
after hydrating, and re-renders if they differ. No effect, no mismatch
warning.

Snapshots are primitives (a string, a boolean) rather than an object, so there
is no memoised-snapshot dance to get wrong.

`color-scheme: light|dark` is set alongside the tokens so native controls —
the `<input type="date">` picker, `<select>` menus, scrollbars — follow too.
Without it the form fields stay stubbornly light inside a dark page.

## 5. Three options, not a switch

"System" is a real answer and a two-state switch cannot express it: the moment
you click a binary toggle you have opted out of ever following the OS again.
So the stored preference (`light | dark | system`) and the applied theme
(`light | dark`) are different types, bridged only by `resolveTheme`.

The control is three radio inputs, visually hidden and styled through
`peer-checked`, inside a `<fieldset>` — the same "use the native element"
principle as the rest of the UI. The group is announced as a group, exactly
one option reads as selected, and arrow-key navigation comes for free rather
than being re-implemented with `onKeyDown`.

## 6. Verification

Ran in headless Chromium against the dev server, using a temporary preview
route (deleted before the final build) rendering every primitive.

| Checked | Result |
|---|---|
| Choice survives a reload | `localStorage` → `dark`, restored |
| **No flash** — theme at the *first animation frame* after reload | `html.dark`, body `rgb(16,18,22)` — already dark before paint |
| Second tab picks up a change in the first | followed within 500 ms via the `storage` event |
| OS flips to dark while preference is "system" | followed |
| OS flips back to light | followed |
| Arrow keys move through the group and apply | yes, and persist |
| Corrupted storage value (`{"nope":1}`) | falls back to "system", page renders |
| Selected option while hovered | stays selected (see below) |

**Contrast** was computed rather than eyeballed — every foreground/background
pair in both themes, scripted against the actual values in `globals.css`.
All 21 pairs per theme pass: body and muted text ≥ 4.5:1, status dots ≥ 3:1,
white-on-solid buttons ≥ 4.5:1.

### Two defects this found

**1. Hovering the selected option made it look deselected.** `hover:` and
`peer-checked:` have equal specificity, so source order decided it and hover
won. With three options and one always selected, a third of the control was
lying whenever the pointer was over it. Caught by reading computed styles
after a click — a screenshot would not have shown it, because the pointer sits
where it clicked. Fixed with `not-peer-checked:hover:`.

**2. `matchMedia()` returns a new object every call.** The listener was being
attached to a throwaway `MediaQueryList` and the cleanup was calling
`removeEventListener` on a *different* instance — so the subscription could be
collected and the removal leaked. Symptom: the panel ignored the OS switching
to dark while set to "system". Fixed by holding one instance.

A third finding turned out **not** to be a bug: a backgrounded tab does not
receive `prefers-color-scheme` change events at all. Bringing the tab to the
front delivered the event immediately. Worth recording, because the first
reading of that trace was "the fix did not work".

### Not verified

- Real macOS/Windows automatic light↔dark switching at sunset — only Chromium's
  `emulateMedia`, which fires the same event.
- Forced-colors / high-contrast OS modes.
- Print styles: the dark theme will print dark.

## 7. Files

```
app/globals.css                      token definitions for both themes
app/layout.tsx                       inlines the pre-paint script
lib/theme/preference.ts              pure rules — resolve, parse, cycle
lib/theme/script.ts                  the no-flash script, built from those constants
lib/theme/store.ts                   useSyncExternalStore over localStorage + matchMedia
lib/theme/__tests__/preference.test.ts   18 tests, incl. script/pure-function agreement
components/layout/theme-toggle.tsx   the control
components/layout/sidebar.tsx        placement, next to the connection indicator
components/ui/index.tsx              the six hardcoded colours, replaced
```
