// Runtime config. In AWS, Terraform writes /config.json next to index.html, so the
// same build works for dev and prod. Locally, copy it from `terraform output` (see README).
let config;

export async function loadConfig() {
  const response = await fetch("/config.json", { cache: "no-store" });
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !type.includes("json")) {
    throw new Error(
      "config.json not found. Run: terraform output -json frontend_config > frontend/public/config.json"
    );
  }
  config = await response.json();
  return config;
}

export const getConfig = () => config;
