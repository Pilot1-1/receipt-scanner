# Builds the website and lets Terraform create/update everything (AWS + site files).
# Usage (from the repo root):  .\scripts\deploy.ps1            # dev
#                              .\scripts\deploy.ps1 -Env prod
#
# If terraform/backend.tf exists (remote state, see docs/setup-guide.md) every environment uses its own
# state file in the state bucket. Without it the state is a local file, which is fine for a single dev
# environment but would mix dev and prod, so prod is refused.
param([string]$Env = "dev")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

Push-Location "$root\frontend"
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
}
finally { Pop-Location }

Push-Location "$root\terraform"
try {
    if (Test-Path "backend.tf") {
        if (-not (Test-Path "backend.hcl")) { throw "backend.tf exists but backend.hcl is missing (see docs/setup-guide.md)" }
        terraform init -input=false -reconfigure -backend-config="backend.hcl" -backend-config="key=$Env/terraform.tfstate"
    }
    elseif ($Env -ne "dev") {
        throw "Refusing to deploy '$Env' with local state: it would share one state file with dev. Set up remote state first (docs/setup-guide.md)."
    }
    else {
        terraform init -input=false
    }
    if ($LASTEXITCODE -ne 0) { throw "terraform init failed" }
    terraform apply -var-file="envs/$Env.tfvars"
    if ($LASTEXITCODE -ne 0) { throw "terraform apply failed" }
    Write-Host "`nWebsite:" (terraform output -raw site_url)
}
finally { Pop-Location }
