<#
.SYNOPSIS
새 PC에서 harness-manager를 받고 개발환경 셋업을 시작한다(앱이 아직 없을 때의 진입점).

.DESCRIPTION
1. winget으로 git, gh를 설치한다(이미 있으면 건너뛴다).
2. 레포를 클론한다(있으면 fast-forward로 최신화한다).
3. 기존 Node는 보존하고, 없는 PC만 NVM/Node 22를 설치·검증한 뒤 hm CLI를 빌드한다.
4. 프로필과 jinmin 마켓플레이스 소스를 저장하고 doctor와 install 미리보기를 보여 준다.
5. -Run이면 할 수 있는 step을 모두 실행한다. -InstallApp이면 최신 릴리스의 설치 파일을 받아 실행한다.

무엇을 할지만 보려면 -DryRun을 쓴다. 아무것도 설치하거나 바꾸지 않는다.

.EXAMPLE
irm https://raw.githubusercontent.com/rafaam11/harness-manager/dev/scripts/bootstrap.ps1 -OutFile bootstrap.ps1
powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1 -Profile dev -DryRun
#>
[CmdletBinding()]
param(
  [string]$Target = (Join-Path $HOME "dev\harness-manager"),
  [ValidateSet("core", "dev", "full")]
  [string]$Profile = "core",
  # 새 PC는 레포를 고치지 않으니 GitHub 소스가 기본이다(개발 PC는 directory).
  [ValidateSet("directory", "github")]
  [string]$SelfSource = "github",
  [switch]$Run,
  [switch]$InstallApp,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Repository = "rafaam11/harness-manager"
$Branch = "dev"

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

# -DryRun이면 무엇을 할지만 출력한다. 바꾸는 동작은 전부 이 함수를 지난다.
function Invoke-Change([string]$Description, [scriptblock]$Action) {
  if ($DryRun) { Write-Host "    (dry-run) $Description" -ForegroundColor DarkGray; return }
  Write-Host "    $Description"
  & $Action
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "실패(종료 코드 $LASTEXITCODE): $Description" }
}

function Test-Command([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# winget으로 설치한 직후에는 이 셸의 PATH에 반영되지 않는다. 시스템·사용자 PATH를 다시 읽는다.
function Update-SessionPath {
  foreach ($name in @('NVM_HOME', 'NVM_SYMLINK')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, 'Machine') }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = ([Environment]::ExpandEnvironmentVariables("$machine;$user") -split ';' | ForEach-Object { $_.Replace('"', '').Trim() } | Where-Object { $_ }) -join ';'
}

if (-not $env:HM_NODE_ORIGINAL_PATH) { $env:HM_NODE_ORIGINAL_PATH = $env:Path }
if (-not $DryRun) { Update-SessionPath }
Write-Step "필수 도구 확인 (git, gh)"
if (-not (Test-Command "winget")) {
  throw "winget이 없습니다. Microsoft Store에서 '앱 설치 관리자'를 설치한 뒤 다시 실행하세요."
}
$required = @(
  @{ Command = "git"; Id = "Git.Git" },
  @{ Command = "gh"; Id = "GitHub.cli" }
)
foreach ($tool in $required) {
  if (Test-Command $tool.Command) {
    Write-Host "    $($tool.Command): 있음"
    continue
  }
  Invoke-Change "winget install --id $($tool.Id)" {
    winget install --id $tool.Id --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  }
}
if (-not $DryRun) { Update-SessionPath }

Write-Step "레포 준비: $Target"
if (Test-Path (Join-Path $Target ".git")) {
  Invoke-Change "git pull --ff-only ($Target)" { git -C $Target pull --ff-only }
} elseif (Test-Path $Target) {
  throw "$Target 이(가) 이미 있지만 git 레포가 아닙니다. -Target으로 다른 위치를 고르세요."
} else {
  Invoke-Change "git clone https://github.com/$Repository.git" {
    git clone --branch $Branch "https://github.com/$Repository.git" $Target
  }
}

Write-Step "Node 실행 환경 확인 (기존 설치 보존)"
Invoke-Change "Node 검사 -> 필요한 경우에만 NVM/Node 22 설치·활성화" {
  # 앱과 같은 파일로 검사한다. MSI Node를 먼저 설치해 NVM 이관을 유발하지 않는다.
  & (Join-Path $Target 'scripts\node-runtime.ps1') -Install
  Update-SessionPath
}

Write-Step "hm CLI 빌드"
$cli = Join-Path $Target "out\main\cli.js"
Invoke-Change "npm ci; npm run build" {
  Push-Location $Target
  try {
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci 실패" }
    npm.cmd run build
  } finally {
    Pop-Location
  }
}

function Invoke-Hm([string[]]$Arguments) {
  if ($DryRun) { Write-Host "    (dry-run) hm $($Arguments -join ' ')" -ForegroundColor DarkGray; return }
  node $cli @Arguments --repo $Target
}

Write-Step "설정 저장: 프로필 $Profile, jinmin 마켓플레이스 소스 $SelfSource"
if ($DryRun) { Write-Host "    (dry-run) hm settings --profile $Profile --self-source $SelfSource" -ForegroundColor DarkGray }
else { node $cli settings --profile $Profile --self-source $SelfSource }

Write-Step "진단"
Invoke-Hm @("doctor")

Write-Step "할 일 미리보기"
Invoke-Hm @("install")

if ($Run) {
  Write-Step "할 수 있는 step 모두 실행"
  Invoke-Hm @("install", "--run", "--only", "all", "--yes")
}

if ($InstallApp) {
  Write-Step "앱 설치 파일 받기(최신 릴리스)"
  Invoke-Change "GitHub 릴리스에서 Harness-Manager-Setup-*.exe 받아 실행" {
    $release = Invoke-RestMethod "https://api.github.com/repos/$Repository/releases/latest" -Headers @{ "User-Agent" = "harness-manager-bootstrap" }
    $asset = $release.assets | Where-Object { $_.name -like "Harness-Manager-Setup-*.exe" } | Select-Object -First 1
    if (-not $asset) { throw "최신 릴리스에 Windows 설치 파일이 없습니다." }
    $installer = Join-Path $env:TEMP $asset.name
    Invoke-WebRequest $asset.browser_download_url -OutFile $installer
    Start-Process $installer -Wait -WindowStyle Hidden
  }
}

Write-Host ""
Write-Host "다음: 로그인(gh auth login, claude, codex login)을 마친 뒤 앱의 셋업 위저드나 'hm doctor'로 확인하세요." -ForegroundColor Green
if (-not $Run) { Write-Host "실행하려면: node `"$cli`" install --run --only all --yes --repo `"$Target`"" }
