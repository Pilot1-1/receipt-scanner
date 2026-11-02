# Останавливает выполнение скрипта при любой ошибке
$ErrorActionPreference = "Stop"

Write-Host "--- Сборка frontend ---" -ForegroundColor Cyan
Set-Location "frontend"

# Настройка политик выполнения для текущего процесса
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned -Force

npm ci
npm run build

# Возвращаемся в корень
Set-Location ".."

Write-Host "--- Применение Terraform для окружения dev ---" -ForegroundColor Cyan
Set-Location "terraform"

terraform init
terraform fmt -recursive
terraform validate
terraform apply "-var-file=envs/dev.tfvars"

# Возвращаемся в корень
Set-Location ".."

Write-Host "--- Все задачи успешно выполнены! ---" -ForegroundColor Green