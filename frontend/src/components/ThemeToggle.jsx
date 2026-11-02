import { useState } from "react";
import { getPreference, setPreference } from "../lib/theme";

const NEXT = { auto: "light", light: "dark", dark: "auto" };
const LABEL = { auto: "Auto", light: "Light", dark: "Dark" };

const ICONS = {
  auto: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
    </>
  ),
  dark: <path d="M20.5 13.6A8.5 8.5 0 1 1 10.4 3.5a6.8 6.8 0 0 0 10.1 10.1z" />,
};

/** One button that cycles Auto, Light and Dark. The icon shows the current choice. */
export default function ThemeToggle() {
  const [preference, setCurrent] = useState(getPreference);
  const next = NEXT[preference];

  function cycle() {
    setPreference(next);
    setCurrent(next);
  }

  return (
    <button
      type="button" className="ghost theme-toggle" onClick={cycle}
      aria-label={`Theme: ${LABEL[preference]}. Switch to ${LABEL[next]}.`} title={`Theme: ${LABEL[preference]}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[preference]}
      </svg>
      <span>{LABEL[preference]}</span>
    </button>
  );
}
