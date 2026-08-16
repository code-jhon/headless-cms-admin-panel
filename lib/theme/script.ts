import {
  DARK_CLASS,
  DEFAULT_PREFERENCE,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
} from "./preference";

/**
 * The no-flash script.
 *
 * The chosen theme lives in `localStorage`, which the server cannot read, so
 * the server-rendered HTML is necessarily theme-less. If the class were
 * applied by React, the first paint would be light and the correct theme
 * would arrive a frame later — a white flash on every navigation for every
 * dark-mode user.
 *
 * This runs synchronously in `<head>`, before the browser paints anything,
 * so the class is already on `<html>` for the first frame. It is inlined
 * rather than imported because an external script would be another round trip
 * in exactly the window that has to stay empty.
 *
 * It is built from the same constants the store uses, so the key and the
 * class name cannot drift apart — and a test asserts the two agree.
 *
 * The whole body is inside try/catch: `localStorage` throws outright in some
 * privacy modes, and a theme preference is not worth a blank page.
 */
export const THEME_SCRIPT = `(function(){try{
var v=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
var p=${JSON.stringify(THEME_PREFERENCES)}.indexOf(v)<0?${JSON.stringify(DEFAULT_PREFERENCE)}:v;
var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle(${JSON.stringify(DARK_CLASS)},d);
}catch(e){}})();`
  .split("\n")
  .join("");
