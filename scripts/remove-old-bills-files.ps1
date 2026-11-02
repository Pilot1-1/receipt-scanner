# One-off clean-up. The first version of the utility bills service lived inside the scanner's own folders.
# Now it is an add-on in bills/, frontend/src/addons/bills/ and terraform/bills.tf, so the old copies must go.
# Run once from the repo root:   .\scripts\remove-old-bills-files.ps1      (afterwards this script can be deleted)
# It removes only the exact paths listed below and says what it removed.
$root = Split-Path $PSScriptRoot -Parent

$old = @(
    "src\bills_api",
    "src\bills_processor",
    "terraform\modules\bills",
    "frontend\src\components\BillsTab.jsx",
    "frontend\src\components\BillDetail.jsx",
    "frontend\src\components\BillUploader.jsx",
    "frontend\src\components\BillsHistory.jsx",
    "frontend\src\lib\bills.js",
    "frontend\src\lib\billsApi.js",
    "frontend\src\lib\billFile.js"
)

$removed = 0
foreach ($path in $old) {
    $full = Join-Path $root $path
    if (Test-Path $full) {
        Remove-Item $full -Recurse -Force
        Write-Host "removed  $path"
        $removed++
    }
}
if ($removed -eq 0) { Write-Host "nothing to remove: no old bills files found" }
