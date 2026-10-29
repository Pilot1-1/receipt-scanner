import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The "buffer" package (pulled in by amazon-cognito-identity-js) reads the Node-only
  // variable `global`, which does not exist in a browser. Without this line the page stays blank.
  define: { global: "globalThis" },
  // Port 5173 is whitelisted for CORS in Terraform (var.dev_origins), so keep it fixed.
  server: { port: 5173, strictPort: true },
});
