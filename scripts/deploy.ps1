# Builds the website and lets Terraform create/update everything (AWS + site files).
# Usage (from the repo root):  .\scripts\deploy.ps1            # dev
#                              .\scripts\deploy.ps1 -Env prod
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
    terraform init -input=false
    if ($LASTEXITCODE -ne 0) { throw "terraform init failed" }
    terraform apply -var-file="envs/$Env.tfvars"
    if ($LASTEXITCODE -ne 0) { throw "terraform apply failed" }
    Write-Host "`nWebsite:" (terraform output -raw site_url)
}
finally { Pop-Location }
