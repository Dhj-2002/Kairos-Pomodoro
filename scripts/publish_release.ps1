<#
.SYNOPSIS
  Publish one deterministic Kairos release to the canonical GitHub repository.

.DESCRIPTION
  The caller supplies the new semantic version, commit message, and exact files
  belonging to the release. The script rejects repository/branch drift,
  unrelated tracked changes, personal backup artifacts, version mismatches,
  failed checks, reused tags, and failed pushes. It never stages by wildcard.

.EXAMPLE
  .\scripts\publish_release.ps1 -Version 1.6.10 `
    -CommitMessage "fix: correct calendar resize" `
    -Files @("src/components/base/calendar-grid.tsx", "src/test/calendar-grid-layout.test.ts")
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$CommitMessage,

  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string[]]$Files,

  [switch]$ValidateOnly,

  [ValidatePattern('^https?://')]
  [string]$ProxyUrl = 'http://127.0.0.1:7897',

  [ValidateRange(5, 60)]
  [int]$ReleaseTimeoutMinutes = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# PowerShell 7 can convert a native command's non-zero exit into a terminating
# error before the script can inspect $LASTEXITCODE. Push fallback relies on
# that inspection, so native failures remain explicit return codes here.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot
$expectedRemote = 'github.com/Dhj-2002/Kairos-Pomodoro.git'
$versionFiles = @('package.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock')
$releaseFiles = @($Files + $versionFiles | Sort-Object -Unique)
$privatePatterns = @(
  '(^|/)(backups?|migration-data|dist-transfer|ci-upload|\.commandcode)(/|$)',
  '(^|/)kairos-backup-.*\.json$',
  '(^|/)Kairos-calendar-sync.*\.json$',
  '\.(db|db-shm|db-wal|dmg|zip|key)$'
)

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function Invoke-GitPush {
  param([Parameter(Mandatory)][string]$Ref)

  # push step 1: Prefer the ordinary network path so environments without a
  # local proxy remain portable.
  & git push origin $Ref
  if ($LASTEXITCODE -eq 0) { return }

  # push step 2: A failed push is idempotently retried through the user's known
  # Clash mixed port. A second failure is terminal and never reported as sent.
  Write-Warning "Direct push failed for $Ref; retrying through $ProxyUrl"
  & git -c "http.proxy=$ProxyUrl" -c "https.proxy=$ProxyUrl" push origin $Ref
  if ($LASTEXITCODE -ne 0) { throw "Push failed through both direct and proxy routes: $Ref" }
}

function Get-RemoteTagReference {
  param([Parameter(Mandatory)][string]$Tag)

  $result = @(& git ls-remote --tags origin "refs/tags/$Tag" 2>$null)
  if ($LASTEXITCODE -eq 0) { return $result }
  $result = @(& git -c "http.proxy=$ProxyUrl" -c "https.proxy=$ProxyUrl" ls-remote --tags origin "refs/tags/$Tag" 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "Cannot verify remote tag through direct or proxy routes: $Tag" }
  return $result
}

function Invoke-GitHubJson {
  param([Parameter(Mandatory)][string]$Uri)

  $headers = @{ Accept = 'application/vnd.github+json' }
  try {
    return Invoke-RestMethod -Uri $Uri -Headers $headers -TimeoutSec 30
  } catch {
    Write-Warning "Direct GitHub API request failed; retrying through $ProxyUrl"
    return Invoke-RestMethod -Proxy $ProxyUrl -Uri $Uri -Headers $headers -TimeoutSec 30
  }
}

function Install-WindowsReleaseAndRepairShortcuts {
  param(
    [Parameter(Mandatory)][string]$InstallerUrl,
    [Parameter(Mandatory)][string]$ExpectedVersion
  )

  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { return }

  $installerPath = Join-Path ([IO.Path]::GetTempPath()) "Kairos-Pomodoro-$ExpectedVersion-setup.exe"
  try {
    try {
      Invoke-WebRequest -Uri $InstallerUrl -OutFile $installerPath -TimeoutSec 120
    } catch {
      Write-Warning "Direct installer download failed; retrying through $ProxyUrl"
      Invoke-WebRequest -Proxy $ProxyUrl -Uri $InstallerUrl -OutFile $installerPath -TimeoutSec 120
    }

    # The release being installed may still be running from an older shortcut.
    # Stop every installed Kairos process before NSIS replaces the executable.
    Get-Process -Name 'Kairos-Pomodoro' -ErrorAction SilentlyContinue | Stop-Process -Force
    $installer = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
    if ($installer.ExitCode -ne 0) {
      throw "Kairos installer exited with code $($installer.ExitCode)"
    }

    $stableExecutable = Join-Path $env:LOCALAPPDATA 'Kairos-Pomodoro\Kairos-Pomodoro.exe'
    if (-not (Test-Path -LiteralPath $stableExecutable)) {
      throw "Installed Kairos executable is missing: $stableExecutable"
    }
    $installedVersion = (Get-Item -LiteralPath $stableExecutable).VersionInfo.ProductVersion
    if ($installedVersion -ne $ExpectedVersion) {
      throw "Installed Kairos version is $installedVersion, expected $ExpectedVersion"
    }

    $shortcutRoots = @(
      [Environment]::GetFolderPath('Desktop'),
      [Environment]::GetFolderPath('StartMenu'),
      (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
    )
    $shell = New-Object -ComObject WScript.Shell
    $shortcuts = @()
    foreach ($root in $shortcutRoots) {
      if (Test-Path -LiteralPath $root) {
        $shortcuts += Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -match 'Kairos' }
      }
    }
    if ($shortcuts.Count -eq 0) {
      $programs = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
      $shortcuts = @([IO.FileInfo](Join-Path $programs 'Kairos-Pomodoro.lnk'))
    }
    foreach ($shortcutFile in $shortcuts) {
      $shortcut = $shell.CreateShortcut($shortcutFile.FullName)
      $shortcut.TargetPath = $stableExecutable
      $shortcut.WorkingDirectory = Split-Path -Parent $stableExecutable
      $shortcut.IconLocation = "$stableExecutable,0"
      $shortcut.Save()
    }
    Start-Process -FilePath $stableExecutable
    Write-Output "Installed Kairos $ExpectedVersion and rebound $($shortcuts.Count) shortcut(s) to $stableExecutable"
  } finally {
    Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
  }
}

function Assert-NoPrivatePath {
  param([string[]]$Paths)
  foreach ($path in $Paths) {
    $normalized = $path.Replace('\', '/')
    foreach ($pattern in $privatePatterns) {
      if ($normalized -match $pattern) { throw "Private or generated artifact cannot be published: $path" }
    }
  }
}

# 1. Pin the destination and branch before touching version files.
$remote = (& git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -notlike "*$expectedRemote") {
  throw "Unexpected origin remote: $remote"
}
$branch = (& git branch --show-current).Trim()
if ($branch -ne 'main') { throw "Release must run from main, current branch is: $branch" }

# 2. Accept only explicitly named release changes. Untracked scratch files may
# remain locally, but modified tracked files outside the list stop the release.
$missing = @($Files | Where-Object { -not (Test-Path -LiteralPath (Join-Path $repoRoot $_)) })
if ($missing.Count -gt 0) { throw "Release file does not exist: $($missing -join ', ')" }
Assert-NoPrivatePath $releaseFiles
$changedTracked = @(& git diff --name-only HEAD; & git diff --cached --name-only) | Sort-Object -Unique
$unexpected = @($changedTracked | Where-Object { $_ -notin $releaseFiles })
if ($unexpected.Count -gt 0) { throw "Unrelated tracked changes detected: $($unexpected -join ', ')" }

# 3. Synchronize the three application version sources exactly once.
$packagePath = Join-Path $repoRoot 'package.json'
$package = Get-Content -LiteralPath $packagePath -Raw
$package = [regex]::Replace($package, '(?m)^(\s*"version"\s*:\s*)"[^"]+"', "`$1`"$Version`"", 1)
[IO.File]::WriteAllText($packagePath, $package, [Text.UTF8Encoding]::new($false))

$cargoTomlPath = Join-Path $repoRoot 'src-tauri/Cargo.toml'
$cargoToml = Get-Content -LiteralPath $cargoTomlPath -Raw
$cargoToml = [regex]::Replace($cargoToml, '(?ms)^(\[package\].*?^version\s*=\s*)"[^"]+"', "`$1`"$Version`"", 1)
[IO.File]::WriteAllText($cargoTomlPath, $cargoToml, [Text.UTF8Encoding]::new($false))

$cargoLockPath = Join-Path $repoRoot 'src-tauri/Cargo.lock'
$cargoLock = Get-Content -LiteralPath $cargoLockPath -Raw
$cargoLock = [regex]::Replace($cargoLock, '(?ms)(\[\[package\]\]\r?\nname = "Kairos-Pomodoro"\r?\nversion = )"[^"]+"', "`$1`"$Version`"", 1)
[IO.File]::WriteAllText($cargoLockPath, $cargoLock, [Text.UTF8Encoding]::new($false))

$resolvedVersions = @(
  (Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version,
  ([regex]::Match((Get-Content -LiteralPath $cargoTomlPath -Raw), '(?ms)^\[package\].*?^version\s*=\s*"([^"]+)"')).Groups[1].Value,
  ([regex]::Match((Get-Content -LiteralPath $cargoLockPath -Raw), '(?ms)\[\[package\]\]\r?\nname = "Kairos-Pomodoro"\r?\nversion = "([^"]+)"')).Groups[1].Value
)
if (@($resolvedVersions | Where-Object { $_ -ne $Version }).Count -gt 0) {
  throw "Version synchronization failed: $($resolvedVersions -join ', ')"
}

# 4. Run the same quality gates used by GitHub before creating an immutable tag.
& bunx --bun tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw 'TypeScript typecheck failed.' }
& bun --bun run test
if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed.' }
Invoke-Git diff --check

if ($ValidateOnly) {
  Write-Output "Release validation passed for v$Version; no files staged, committed, tagged, or pushed."
  return
}

# 5. Stage the exact allow-list, then audit the resulting commit contents.
Invoke-Git add -- @releaseFiles
$staged = @(& git diff --cached --name-only)
Assert-NoPrivatePath $staged
$unexpectedStaged = @($staged | Where-Object { $_ -notin $releaseFiles })
if ($unexpectedStaged.Count -gt 0) { throw "Unexpected staged file: $($unexpectedStaged -join ', ')" }
if ($staged.Count -eq 0) { throw 'No release changes were staged.' }

$tag = "v$Version"
& git rev-parse --verify --quiet "refs/tags/$tag" *> $null
if ($LASTEXITCODE -eq 0) { throw "Local tag already exists: $tag" }
$remoteTag = @(Get-RemoteTagReference $tag)
if ($remoteTag.Count -gt 0) { throw "Remote tag already exists: $tag" }

# 6. Commit first, then push main and the matching tag. The tag is the only
# trigger for the signed multi-platform GitHub Release workflow.
Invoke-Git commit -m $CommitMessage
Invoke-Git tag $tag
Invoke-GitPush main
Invoke-GitPush $tag

$sha = (& git rev-parse HEAD).Trim()
$actionsUrl = 'https://github.com/Dhj-2002/Kairos-Pomodoro/actions/workflows/release.yml'
Write-Output "Source and tag pushed for $tag at $sha"

# 7. A push is not a completed release. Poll the exact public endpoint used by
# installed apps; this avoids anonymous Actions API rate limits and proves the
# final cross-platform merge has actually replaced all matrix partials.
$deadline = (Get-Date).AddMinutes($ReleaseTimeoutMinutes)
$manifest = $null
$lastObservedVersion = $null
$latestUrl = 'https://github.com/Dhj-2002/Kairos-Pomodoro/releases/latest/download/latest.json'
$requiredPlatforms = @('darwin-x86_64', 'darwin-aarch64', 'windows-x86_64', 'linux-x86_64')
while ((Get-Date) -lt $deadline) {
  $cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  try {
    $candidate = Invoke-GitHubJson "$latestUrl`?release_check=$cacheBust"
    if ($candidate.version -ne $lastObservedVersion) {
      Write-Output "Latest updater currently reports version $($candidate.version)"
      $lastObservedVersion = $candidate.version
    }
    if ($candidate.version -eq $Version) {
      $complete = $true
      foreach ($platform in $requiredPlatforms) {
        $property = $candidate.platforms.PSObject.Properties[$platform]
        if (-not $property -or -not $property.Value.url -or -not $property.Value.signature) {
          $complete = $false
          break
        }
      }
      if ($complete -and $candidate.platforms.'darwin-x86_64'.url -match 'Kairos-Pomodoro_x64\.app\.tar\.gz$') {
        $manifest = $candidate
        break
      }
    }
  } catch {
    Write-Warning "Updater manifest not ready: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 30
}
if (-not $manifest) {
  throw "A complete v$Version updater manifest was not published within $ReleaseTimeoutMinutes minutes. Check $actionsUrl"
}

Write-Output "Published and verified $tag at $sha"
Write-Output "Actions: $actionsUrl"
Write-Output "Intel updater: $($manifest.platforms.'darwin-x86_64'.url)"

# 8. Keep this Windows development machine on the release it just published.
# The shortcut always targets the stable per-user install path rather than a
# Codex LocalCache copy or a version-specific build artifact.
$windowsInstallerUrl = $manifest.platforms.'windows-x86_64-nsis'.url
if (-not $windowsInstallerUrl) {
  throw "Published manifest has no Windows NSIS installer URL."
}
Install-WindowsReleaseAndRepairShortcuts -InstallerUrl $windowsInstallerUrl -ExpectedVersion $Version
