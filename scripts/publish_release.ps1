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

  [switch]$ValidateOnly
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
& git ls-remote --exit-code --tags origin "refs/tags/$tag" *> $null
if ($LASTEXITCODE -eq 0) { throw "Remote tag already exists: $tag" }

# 6. Commit first, then push main and the matching tag. The tag is the only
# trigger for the signed multi-platform GitHub Release workflow.
Invoke-Git commit -m $CommitMessage
Invoke-Git tag $tag
Invoke-Git push origin main
Invoke-Git push origin $tag

$sha = (& git rev-parse HEAD).Trim()
Write-Output "Published $tag at $sha"
Write-Output 'Actions: https://github.com/Dhj-2002/Kairos-Pomodoro/actions/workflows/release.yml'
