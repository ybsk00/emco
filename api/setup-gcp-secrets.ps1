<#
  엠코 챗봇 — GCP Secret Manager 등록 헬퍼

  api/.env 에서 키를 읽어 다음 시크릿을 생성합니다 (이미 있으면 새 버전 추가):
    - emco-supabase-key  ← SUPABASE_SERVICE_ROLE_KEY
    - emco-gemini-key    ← GEMINI_API_KEY
    - emco-ip-salt       ← IP_HASH_SALT
    - emco-admin-user    ← ADMIN_USERNAME
    - emco-admin-pass    ← ADMIN_PASSWORD
#>
param(
  [string]$Project = "",
  [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not (Test-Path $EnvFile)) {
  Write-Host "ERROR: $EnvFile not found. Run from api/ directory." -ForegroundColor Red
  exit 1
}

# Parse .env
$envValues = @{}
foreach ($line in Get-Content $EnvFile) {
  if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
  if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
    $envValues[$matches[1]] = $matches[2].Trim('"').Trim("'")
  }
}

$secretMap = @(
  [PSCustomObject]@{ Name = "emco-supabase-key"; Key = "SUPABASE_SERVICE_ROLE_KEY" }
  [PSCustomObject]@{ Name = "emco-gemini-key";   Key = "GEMINI_API_KEY" }
  [PSCustomObject]@{ Name = "emco-ip-salt";      Key = "IP_HASH_SALT" }
  [PSCustomObject]@{ Name = "emco-admin-user";   Key = "ADMIN_USERNAME" }
  [PSCustomObject]@{ Name = "emco-admin-pass";   Key = "ADMIN_PASSWORD" }
)

$projectArgs = @()
if ($Project) { $projectArgs = @("--project", $Project) }

Write-Host "==== GCP Secret Manager Registration ====" -ForegroundColor Cyan
if ($Project) { Write-Host "Project: $Project" }

foreach ($s in $secretMap) {
  $name = $s.Name
  $key  = $s.Key
  $value = $envValues[$key]

  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Host "  [$name] $key is empty in .env, skipping." -ForegroundColor Yellow
    continue
  }

  # Temp data file for the secret value (no BOM, no newline)
  $tmpDat = Join-Path $env:TEMP ("secret_" + [System.Guid]::NewGuid().ToString("N") + ".dat")
  [System.IO.File]::WriteAllText($tmpDat, $value, [System.Text.UTF8Encoding]::new($false))

  try {
    # Existence check (capture stderr; ignore message, only check exit code)
    $describeArgs = @("secrets", "describe", $name) + $projectArgs + @("--format=value(name)")
    & gcloud @describeArgs *> $null
    $exists = ($LASTEXITCODE -eq 0)

    if ($exists) {
      Write-Host -NoNewline "  [$name] add new version ... "
      $cmdArgs = @("secrets", "versions", "add", $name, "--data-file=$tmpDat") + $projectArgs + @("--quiet")
    } else {
      Write-Host -NoNewline "  [$name] create new ... "
      $cmdArgs = @("secrets", "create", $name, "--data-file=$tmpDat", "--replication-policy=automatic") + $projectArgs + @("--quiet")
    }

    & gcloud @cmdArgs *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "OK ($($value.Length) chars)" -ForegroundColor Green
    } else {
      Write-Host "FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
    }
  } finally {
    Remove-Item -LiteralPath $tmpDat -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "Registered emco-* secrets:" -ForegroundColor Cyan
$listArgs = @("secrets", "list") + $projectArgs + @("--filter=name~emco-", "--format=table(name.basename(),createTime.date('%Y-%m-%d %H:%M'))")
& gcloud @listArgs
