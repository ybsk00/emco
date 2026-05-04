<#
  엠코 챗봇 — GCP Secret Manager 등록 헬퍼

  api/.env 에서 키를 읽어 다음 시크릿을 생성합니다 (이미 있으면 새 버전 추가):
    - emco-supabase-key  ← SUPABASE_SERVICE_ROLE_KEY
    - emco-gemini-key    ← GEMINI_API_KEY
    - emco-ip-salt       ← IP_HASH_SALT

  ⚠️ 키 값은 stdout/log 어디에도 출력되지 않고, 임시 파일은 즉시 삭제됩니다.

  사용법:
    cd api
    .\setup-gcp-secrets.ps1                       # 현재 gcloud project
    .\setup-gcp-secrets.ps1 -Project emco-8a3b5   # 명시 지정

  사전 조건:
    - gcloud auth login 완료
    - Secret Manager API 활성화
      (gcloud services enable secretmanager.googleapis.com)
#>
param(
  [string]$Project = "",
  [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $EnvFile)) {
  Write-Error "$EnvFile 가 없습니다. cd api 후 실행해 주세요."
  exit 1
}

# .env 파싱 — KEY=VALUE 형식 (주석 #, 빈 줄 제외)
$envValues = @{}
foreach ($line in Get-Content $EnvFile) {
  if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
  if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
    $envValues[$matches[1]] = $matches[2].Trim('"').Trim("'")
  }
}

# 등록할 시크릿 매핑
$secretMap = @(
  @{ Name = "emco-supabase-key"; EnvKey = "SUPABASE_SERVICE_ROLE_KEY" }
  @{ Name = "emco-gemini-key";   EnvKey = "GEMINI_API_KEY" }
  @{ Name = "emco-ip-salt";      EnvKey = "IP_HASH_SALT" }
)

$projectArg = @()
if ($Project) { $projectArg = @("--project", $Project) }

Write-Host "==== GCP Secret Manager 등록 시작 ====" -ForegroundColor Cyan
if ($Project) { Write-Host "Project: $Project" }

foreach ($secret in $secretMap) {
  $name = $secret.Name
  $key  = $secret.EnvKey
  $value = $envValues[$key]

  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Warning "  $name : .env 에 $key 가 비어있어 건너뜁니다."
    continue
  }

  # 임시 파일 — ASCII, BOM/newline 없음
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tmp, $value, [System.Text.UTF8Encoding]::new($false))

    # 이미 존재하나?
    $null = & gcloud secrets describe $name @projectArg --format=value(name) 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "  $name : 새 버전 추가 ..." -NoNewline
      $null = & gcloud secrets versions add $name --data-file=$tmp @projectArg --quiet 2>&1
    } else {
      Write-Host "  $name : 신규 생성 ..." -NoNewline
      $null = & gcloud secrets create $name --data-file=$tmp --replication-policy=automatic @projectArg --quiet 2>&1
    }
    if ($LASTEXITCODE -eq 0) {
      Write-Host " OK ($(($value).Length) chars)" -ForegroundColor Green
    } else {
      Write-Host " FAILED" -ForegroundColor Red
    }
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "현재 등록된 시크릿:" -ForegroundColor Cyan
& gcloud secrets list @projectArg --filter="name~^projects/.*/secrets/emco-" --format="table(name.basename(),createTime.date('%Y-%m-%d %H:%M'))"
