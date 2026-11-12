import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import "./features.css"; // tabs, charts, filters, products, budgets: loaded after styles.css so it can refine it
import "./theme.css"; // the dark theme
import "./pwa.css"; // safe areas for the installed app, loaded last

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadConfig } from "./lib/config";

const root = createRoot(document.getElementById("root"));

loadConfig()
  .then(() => root.render(<StrictMode><App /></StrictMode>))
  .catch((error) =>
    root.render(
      <main className="boot">
        <h1>The app is not configured</h1>
        <p>{error.message}</p>
      </main>
    )
  );

// Makes the site installable ("Add to Home Screen"). Only in the production build: during "npm run dev"
// a service worker would serve stale files. Not needed inside a Capacitor APK, where the files are local.
if ("serviceWorker" in navigator && import.meta.env.PROD && !window.Capacitor) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
