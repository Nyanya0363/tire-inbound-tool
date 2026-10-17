param(
    [string]$Source = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Work = $PSScriptRoot
$Root = Split-Path -Parent $Work
$Target = Join-Path $Root "public\catalog.json"
$Inbox = Join-Path $Work "catalog-inbox"

function Fail($message) {
    Write-Host ""
    Write-Host "[错误] $message" -ForegroundColor Red
    exit 1
}

if (-not $Source) {
    $candidates = @()
    $candidates += Get-ChildItem -LiteralPath $Work -Filter "catalog*.json" -File -ErrorAction SilentlyContinue
    $candidates += Get-ChildItem -LiteralPath $Inbox -Filter "catalog*.json" -File -ErrorAction SilentlyContinue
    $newest = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest) {
        $Source = $newest.FullName
    }
}

if (-not $Source) {
    Fail "没有找到 catalog.json。请把下载的 catalog.json 放到 catalog-inbox，或直接拖到 bat 上。"
}

if (-not (Test-Path -LiteralPath $Source)) {
    Fail "找不到文件：$Source"
}

Write-Host "使用文件：" -ForegroundColor Cyan
Write-Host "  $Source"
Write-Host ""

try {
    $data = Get-Content -LiteralPath $Source -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Fail "catalog.json 不是合法的 JSON：$($_.Exception.Message)"
}

if (-not $data.products -or $data.products.Count -eq 0) {
    Fail "catalog.json 里没有商品数据。"
}

foreach ($product in $data.products) {
    if (-not $product.code -or -not $product.spec) {
        Fail "存在缺少商品编号或规格的商品，catalog.json 可能不完整。"
    }
}

Write-Host "校验通过：$($data.products.Count) 个商品，版本 $($data.version)" -ForegroundColor Green
Write-Host ""

try {
    Copy-Item -LiteralPath $Source -Destination $Target -Force
} catch {
    Fail "复制到 public\catalog.json 失败：$($_.Exception.Message)"
}

Set-Location -LiteralPath $Root

Write-Host "检查 Git 变更..." -ForegroundColor Cyan
git add public/catalog.json
if ($LASTEXITCODE -ne 0) {
    Fail "git add 失败。"
}

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "商品目录没有变化，不需要提交。" -ForegroundColor Green
    Write-Host "当前已是最新版本。"
    exit 0
}

Write-Host "提交并推送..." -ForegroundColor Cyan
git commit -m "chore: update product catalog"
if ($LASTEXITCODE -ne 0) {
    Fail "git commit 失败。"
}

git -c http.proxy= -c https.proxy= push
if ($LASTEXITCODE -ne 0) {
    Fail "git push 失败。请检查网络或 GitHub 登录状态。"
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "已推送成功！" -ForegroundColor Green
Write-Host "GitHub Actions 会自动重新部署。"
Write-Host "线上地址："
Write-Host "https://nyanya0363.github.io/tire-inbound-tool/"
Write-Host "==========================================" -ForegroundColor Green
exit 0
