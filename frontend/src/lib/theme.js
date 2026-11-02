// Light / dark theme. The page always carries data-theme="light" or "dark" on <html>; theme.css styles the dark one.
// The choice is "auto" (follow the system, also when the system changes), "light" or "dark".
// index.html applies the saved choice before the first paint, so there is no flash of the wrong theme.
const KEY = "theme";

export const PREFERENCES = ["auto", "light", "dark"];

const systemIsDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export function getPreference() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto"; // storage blocked (private mode): the choice just is not remembered
  }
}

function apply(preference) {
  const dark = preference === "auto" ? systemIsDark() : preference === "dark";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

export function setPreference(preference) {
  try {
    if (preference === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, preference);
  } catch {
    // not remembered, but it still applies until the page is closed
  }
  apply(preference);
}

/** Apply the saved choice and follow the system while the choice is "auto". Returns a cleanup function. */
export function initTheme() {
  apply(getPreference());
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!query) return undefined;
  const onChange = () => { if (getPreference() === "auto") apply("auto"); };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
