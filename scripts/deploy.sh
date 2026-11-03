#!/usr/bin/env bash
# Builds the website and lets Terraform create/update everything (AWS + site files).
# Usage (from anywhere):  ./scripts/deploy.sh          # dev
#                         ./scripts/deploy.sh prod
#
# Same rules as deploy.ps1: with terraform/backend.tf every environment has its own remote state file;
# without it the state is local and only dev is allowed.
set -euo pipefail

ENV_NAME="${1:-dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Building the website"
(cd "$ROOT/frontend" && npm ci && npm run build)

echo "==> Terraform ($ENV_NAME)"
cd "$ROOT/terraform"
if [ -f backend.tf ]; then
  [ -f backend.hcl ] || { echo "backend.tf exists but backend.hcl is missing (see docs/setup-guide.md)" >&2; exit 1; }
  terraform init -input=false -reconfigure -backend-config=backend.hcl -backend-config="key=${ENV_NAME}/terraform.tfstate"
elif [ "$ENV_NAME" != "dev" ]; then
  echo "Refusing to deploy '$ENV_NAME' with local state: it would share one state file with dev." >&2
  echo "Set up remote state first (docs/setup-guide.md)." >&2
  exit 1
else
  terraform init -input=false
fi

terraform apply -var-file="envs/${ENV_NAME}.tfvars"
echo
echo "Website: $(terraform output -raw site_url)"
