import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import "./features.css"; // tabs, charts, filters, products, budgets: loaded after styles.css so it can refine it

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
