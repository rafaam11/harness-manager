[CmdletBinding()]
param([switch]$Inspect, [switch]$Install, [switch]$DryRun)

# bootstrap과 앱이 같은 검사를 거쳐야 기존 Node를 NVM의 무인 이관으로 넘기지 않는다.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
$script:NodeMajor = '22'
$script:TerminalNotice = '환경이 변경되었습니다. 이미 열려 있던 터미널과 터미널을 여는 앱을 완전히 종료한 뒤 다시 여세요.'

function Update-HmRuntimeEnvironment {
    foreach ($name in @('NVM_HOME', 'NVM_SYMLINK')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'User')
        if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, 'Machine') }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = ([Environment]::ExpandEnvironmentVariables("$machine;$user") -split ';' | ForEach-Object { $_.Replace('"', '').Trim() } | Where-Object { $_ }) -join ';'
}

function Get-HmRuntimeRegistrations {
    # Win32_Product는 조회만 해도 MSI 복구를 일으킬 수 있어 사용하지 않는다.
    $roots = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction Stop) {
            $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
            if ($entry.DisplayName -match '^Node\.js$|^NVM for Windows') {
                [PSCustomObject]@{ name = $entry.DisplayName; version = $entry.DisplayVersion; location = $entry.InstallLocation; id = $key.PSChildName }
            }
        }
    }
}

function Get-HmRuntimeCommand([string]$Name) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
}

function Read-HmRuntimeVersion([string]$File) {
    if (-not $File) { return $null }
    try {
        $output = & $File --version 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        $line = ($output | Select-Object -First 1).Trim()
        if ($line -match '^v?\d+\.\d+\.\d+$') { return $line }
    } catch { }
    return $null
}

function Test-HmNodeVersion([string]$Version) {
    return $Version -match '^v?\d+\.\d+\.\d+$' -and [version]($Version.TrimStart('v')) -ge [version]'22.12.0'
}

function Get-HmNodeRealPath([string]$File) {
    try {
        $resolved = [string](& $File -p "require('fs').realpathSync(process.execPath)" 2>$null)
        if ($LASTEXITCODE -eq 0 -and $resolved) { return $resolved }
    } catch { }
    return $File
}

function Get-HmNodeState {
    $oldPath = $env:Path
    $originalPath = $env:HM_NODE_ORIGINAL_PATH
    Update-HmRuntimeEnvironment
    $registrations = @(Get-HmRuntimeRegistrations)
    $msi = @($registrations | Where-Object { $_.name -eq 'Node.js' })
    $nvmRegistrations = @($registrations | Where-Object { $_.name -like 'NVM for Windows*' })
    $node = Get-HmRuntimeCommand 'node.exe'
    $npm = Get-HmRuntimeCommand 'npm.cmd'
    $nvm = Get-HmRuntimeCommand 'nvm.exe'
    $defaultNvm = Join-Path $env:LOCALAPPDATA 'nvm'
    $nvmRemainder = (Test-Path -LiteralPath $defaultNvm) -and -not (Test-Path -LiteralPath (Join-Path $defaultNvm 'nvm.exe')) -and -not (Test-Path -LiteralPath (Join-Path $defaultNvm 'settings.txt'))
    $nvmHomes = @(@($env:NVM_HOME, $(if (-not $nvmRemainder) { $defaultNvm })) + @($nvmRegistrations | ForEach-Object { $_.location }) |
        Where-Object { $_ -and (Test-Path -LiteralPath $_) } | ForEach-Object { $_.TrimEnd('\') } | Select-Object -Unique)
    if ($nvm) { $nvmHomes = @($nvmHomes + (Split-Path -Parent $nvm) | Select-Object -Unique) }
    $nvmRoot = $null
    $nvmLink = $env:NVM_SYMLINK
    $problems = @()
    if ($nvmHomes.Count -gt 1) { $problems += 'NVM 설치 위치가 여러 개입니다' }
    if ($nvmHomes.Count -eq 1) {
        $nvmRoot = $nvmHomes[0]
        if (-not $nvm) {
            $candidate = Join-Path $nvmRoot 'nvm.exe'
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $nvm = $candidate }
        }
        $settingsFile = Join-Path $nvmRoot 'settings.txt'
        if (Test-Path -LiteralPath $settingsFile -PathType Leaf) {
            $settings = Get-Content -LiteralPath $settingsFile
            $rootLine = @($settings | Where-Object { $_ -match '^root:\s*\S' })
            $linkLine = @($settings | Where-Object { $_ -match '^path:\s*\S' })
            if ($rootLine.Count -eq 1 -and $linkLine.Count -eq 1) {
                $nvmRoot = ($rootLine[0] -replace '^root:\s*', '').Trim()
                $nvmLink = ($linkLine[0] -replace '^path:\s*', '').Trim()
                if (-not [IO.Path]::IsPathRooted($nvmRoot) -or -not [IO.Path]::IsPathRooted($nvmLink)) { $problems += 'NVM 설정 경로가 올바르지 않습니다' }
                if ($env:NVM_HOME -ne (Split-Path -Parent $nvm) -or $env:NVM_SYMLINK -ne $nvmLink) { $problems += 'NVM 환경변수와 settings.txt가 다릅니다' }
            } else { $problems += 'NVM settings.txt를 해석하지 못했습니다' }
        } else { $problems += 'NVM settings.txt가 없습니다' }
        if (-not (Read-HmRuntimeVersion $nvm)) { $problems += 'NVM 실행을 확인하지 못했습니다' }
    } elseif ($nvmRegistrations.Count -gt 0 -or $env:NVM_HOME -or $env:NVM_SYMLINK) {
        $problems += 'NVM 등록 또는 환경변수만 남아 있습니다'
    }
    $versions = @()
    if ($nvmRoot -and (Test-Path -LiteralPath $nvmRoot)) {
        $versions = @(Get-ChildItem -LiteralPath $nvmRoot -Directory | Where-Object { $_.Name -match '^v\d+\.\d+\.\d+$' } | ForEach-Object { $_.Name.Substring(1) })
    }
    if ($nvmLink -and (Test-Path -LiteralPath $nvmLink)) {
        $linkItem = Get-Item -LiteralPath $nvmLink -Force
        if (-not ($linkItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $problems += 'NVM 링크 위치에 실폴더가 있습니다. 자동으로 바꾸지 않습니다' }
    }
    if (-not $nvm -and (Test-Path -LiteralPath 'C:\nvm4w\nodejs')) { $problems += 'NVM 기본 링크 위치가 이미 사용 중입니다' }
    $dirs = @(("$oldPath;$originalPath;$env:Path" -split ';') + @(
        (Join-Path $env:ProgramFiles 'nodejs'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs'), $nvmLink
    ) + @($msi | ForEach-Object { $_.location }) | Where-Object { $_ } | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_.Replace('"', '').Trim()) } | Select-Object -Unique)
    if (${env:ProgramFiles(x86)}) { $dirs += Join-Path ${env:ProgramFiles(x86)} 'nodejs' }
    $candidates = @()
    foreach ($dir in $dirs) {
        $file = Join-Path $dir 'node.exe'
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        $version = Read-HmRuntimeVersion $file
        $realPath = $file
        if ($version) { $realPath = Get-HmNodeRealPath $file }
        if (-not @($candidates | Where-Object { $_.realPath -eq $realPath }).Count) {
            $candidates += [PSCustomObject]@{ path = $file; realPath = $realPath; version = $version }
        }
    }
    $nodeVersion = Read-HmRuntimeVersion $node
    $npmVersion = Read-HmRuntimeVersion $npm
    if ($candidates.Count -gt 1) { $problems += '서로 다른 Node.js 설치본이 여러 개 있습니다' }
    if ($msi.Count -gt 1) { $problems += 'Node.js MSI 등록이 여러 개입니다' }
    if ($msi.Count -gt 0 -and ($nvmRoot -or $nvmRegistrations.Count -gt 0)) { $problems += 'MSI Node와 NVM이 함께 등록되어 있습니다' }
    if ($node -and -not (Test-HmNodeVersion $nodeVersion)) { $problems += 'Node 실행 실패 또는 지원 버전(22.12.0 이상) 미달입니다' }
    if ($node -and -not $npmVersion) { $problems += 'npm 실행에 실패했습니다' }
    if (-not $node -and ($candidates.Count -gt 0 -or $msi.Count -gt 0)) { $problems += '기존 Node 설치는 있지만 PATH에서 실행할 수 없습니다' }
    if (-not $node -and $nvmRemainder) { $problems += '이전 NVM 폴더가 남아 있습니다' }
    $state = 'fresh'
    $detail = 'Node가 없습니다. NVM과 Node 22를 설치하고 활성화합니다'
    if ($problems.Count -gt 0) {
        $state = 'blocked'; $detail = ($problems -join ' · ') + '. 기존 설치를 자동 이관하거나 제거하지 않습니다'
    } elseif ($node) {
        $state = 'ready'; $detail = "$nodeVersion · $node · npm $npmVersion — 기존 설치 유지"
        if ($nvmRemainder) { $detail += ' (사용하지 않는 NVM 잔여 폴더는 보존합니다)' }
    } elseif ($nvm) {
        $state = 'empty-nvm'; $detail = 'NVM은 있지만 활성 Node가 없습니다. Node 22 설치·활성화가 필요합니다'
    }
    [PSCustomObject]@{
        state = $state; detail = $detail; node = $node; nodeVersion = $nodeVersion; npmVersion = $npmVersion
        candidates = @($candidates); registrations = @($registrations); nvm = $nvm; nvmRoot = $nvmRoot; nvmLink = $nvmLink; versions = @($versions)
        environment = @{ Path = $env:Path; NVM_HOME = $env:NVM_HOME; NVM_SYMLINK = $env:NVM_SYMLINK }
        pathChanged = $oldPath -ne $env:Path
    }
}

function Invoke-HmRuntimeCommand([string]$Command, [string[]]$Arguments) {
    Write-Host ('$ ' + $Command + ' ' + ($Arguments -join ' '))
    & $Command @Arguments | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw "$Command 실패 (종료 코드 $LASTEXITCODE)" }
}

function Install-HmNodeRuntime {
    $state = Get-HmNodeState
    if ($state.state -eq 'ready') { Write-Host $state.detail; return }
    if ($state.state -eq 'blocked') { throw $state.detail }
    if ($DryRun) { Write-Host '(dry-run) 기존 설치 검사 -> 필요 시 NVM -> nvm install 22 -> 설치된 정확한 버전으로 nvm use -> node/npm 검증'; return }
    if (-not $state.nvm) {
        # 미리보기와 실행 사이에 Node가 생긴 경우에도 무인 이관을 허용하지 않는다.
        $state = Get-HmNodeState
        if ($state.state -eq 'ready') { Write-Host $state.detail; return }
        if ($state.state -ne 'fresh') { throw '설치 상태가 바뀌었습니다. 다시 진단하세요' }
        Invoke-HmRuntimeCommand 'winget.exe' @('install', '--id', 'CoreyButler.NVMforWindows', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
        Write-Host $script:TerminalNotice
        $state = Get-HmNodeState
        if ($state.state -ne 'empty-nvm') { throw ('NVM 설치 후 검증 실패: ' + $state.detail) }
    }
    Invoke-HmRuntimeCommand $state.nvm @('install', $script:NodeMajor)
    $state = Get-HmNodeState
    if ($state.state -eq 'blocked' -or $state.state -eq 'ready') { throw ('설치 중 상태가 바뀌었습니다: ' + $state.detail) }
    $version = @($state.versions | Where-Object { $_ -match '^22\.\d+\.\d+$' -and (Test-HmNodeVersion $_) } | Sort-Object { [version]$_ } -Descending | Select-Object -First 1)
    if ($version.Count -ne 1) { throw 'nvm install 종료 후에도 정상 Node 22 설치를 찾지 못했습니다' }
    $installedNode = Join-Path $state.nvmRoot ("v" + $version[0] + '\node.exe')
    if ((Read-HmRuntimeVersion $installedNode) -ne ('v' + $version[0])) { throw '설치된 Node 22 실행 검증에 실패했습니다' }
    Invoke-HmRuntimeCommand $state.nvm @('use', $version[0])
    Write-Host $script:TerminalNotice
    $after = Get-HmNodeState
    if ($after.state -ne 'ready' -or $after.nodeVersion -ne ('v' + $version[0]) -or (Get-HmNodeRealPath $after.node) -ne (Get-HmNodeRealPath $installedNode)) { throw ('Node 활성화 검증 실패: ' + $after.detail) }
    Write-Host $after.detail
}

if ($Inspect) {
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
    Get-HmNodeState | ConvertTo-Json -Depth 6 -Compress
} elseif ($Install) {
    Install-HmNodeRuntime
}
