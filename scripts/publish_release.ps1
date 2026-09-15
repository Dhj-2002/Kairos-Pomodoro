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

# 7. A push is not a completed release. Wait for the tagged workflow, including
# its final cross-platform manifest merge, and fail on cancellation or errors.
$deadline = (Get-Date).AddMinutes($ReleaseTimeoutMinutes)
$run = $null
$lastState = $null
while ((Get-Date) -lt $deadline) {
  $runs = Invoke-GitHubJson 'https://api.github.com/repos/Dhj-2002/Kairos-Pomodoro/actions/runs?event=push&per_page=20'
  $run = @($runs.workflow_runs | Where-Object { $_.head_branch -eq $tag -and $_.head_sha -eq $sha })[0]
  if ($run) {
    $state = "$($run.status)/$($run.conclusion)"
    if ($state -ne $lastState) {
      Write-Output "GitHub Actions: $state $($run.html_url)"
      $lastState = $state
    }
    if ($run.status -eq 'completed') { break }
  }
  Start-Sleep -Seconds 30
}
if (-not $run -or $run.status -ne 'completed') {
  throw "Release workflow did not finish within $ReleaseTimeoutMinutes minutes. Check $actionsUrl"
}
if ($run.conclusion -ne 'success') {
  throw "Release workflow finished with $($run.conclusion): $($run.html_url)"
}

# 8. Verify the endpoint used by the installed app, not merely the tag page.
# This catches matrix jobs overwriting latest.json with a one-platform file.
$cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$manifest = Invoke-GitHubJson "https://github.com/Dhj-2002/Kairos-Pomodoro/releases/latest/download/latest.json?release_check=$cacheBust"
if ($manifest.version -ne $Version) {
  throw "Latest updater version is $($manifest.version), expected $Version"
}
$requiredPlatforms = @('darwin-x86_64', 'darwin-aarch64', 'windows-x86_64', 'linux-x86_64')
foreach ($platform in $requiredPlatforms) {
  $property = $manifest.platforms.PSObject.Properties[$platform]
  if (-not $property) { throw "Published latest.json is missing $platform" }
  $entry = $property.Value
  if (-not $entry.url -or -not $entry.signature) {
    throw "Published latest.json is incomplete for $platform"
  }
}
if ($manifest.platforms.'darwin-x86_64'.url -notmatch 'Kairos-Pomodoro_x64\.app\.tar\.gz$') {
  throw "Intel Mac updater URL is unexpected: $($manifest.platforms.'darwin-x86_64'.url)"
}

Write-Output "Published and verified $tag at $sha"
Write-Output "Actions: $($run.html_url)"
Write-Output "Intel updater: $($manifest.platforms.'darwin-x86_64'.url)"
