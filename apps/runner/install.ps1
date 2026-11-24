# Installs lictory-runner on Windows from a GitHub release of Lictory,
# published as the release asset `lictory-runner-install.ps1`:
#
#   irm https://github.com/chricarp/lictory/releases/latest/download/lictory-runner-install.ps1 | iex
#   & ([scriptblock]::Create((irm https://github.com/chricarp/lictory/releases/latest/download/lictory-runner-install.ps1))) `
#     -Version 0.27.0 -Url https://lictory.example.com -Token lrt_… -Service
#
# It downloads the binary for this computer (x64 or arm64), checks it
# against the release's SHA256SUMS, installs it for the current user in
# %LOCALAPPDATA%\Programs\lictory-runner (replacing an older one), adds that
# folder to the user's PATH and, given -Url and -Token, registers the runner;
# -Service also prints the Task Scheduler commands that keep it running.
#
# Parameters (or environment variables): -Version (LICTORY_RUNNER_VERSION,
# default the latest stable release), -InstallDir (LICTORY_RUNNER_INSTALL_DIR),
# -Url, -Token, -Name, -Service. LICTORY_RUNNER_DOWNLOAD_URL replaces the
# base URL of the release files (mirrors, tests).
#
# Later releases keep publishing this script under the same name and the
# binaries as lictory-runner-windows-<x64|arm64>.exe, so the newest script
# installs any release. Linux and macOS: lictory-runner-install.sh.
param(
  [string]$Version = $(if ($env:LICTORY_RUNNER_VERSION) { $env:LICTORY_RUNNER_VERSION } else { "latest" }),
  [string]$InstallDir = $env:LICTORY_RUNNER_INSTALL_DIR,
  [string]$Url,
  [string]$Token,
  [string]$Name,
  [switch]$Service
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest is much slower with a progress bar.
# Windows PowerShell 5.1 may default to TLS 1.0, which GitHub refuses.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Fail([string]$Message) {
  throw "lictory-runner install: $Message"
}

$repository = "https://github.com/chricarp/lictory"
if ([bool]$Url -ne [bool]$Token) { Fail "-Url and -Token go together." }
if ($Service -and -not $Url) { Fail "-Service needs -Url and -Token (or run: lictory-runner install-service)." }

# The operating system's architecture, not this PowerShell's: an x64
# PowerShell under emulation on arm64 still installs the native binary.
$machine = $env:PROCESSOR_ARCHITEW6432
if (-not $machine) { $machine = $env:PROCESSOR_ARCHITECTURE }
try {
  $machine = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
} catch { }
switch -Regex ($machine) {
  "^(X64|AMD64)$" { $arch = "x64" }
  "^(Arm64|ARM64)$" { $arch = "arm64" }
  default { Fail "$machine is not supported: lictory-runner is built for x64 and arm64." }
}
$asset = "lictory-runner-windows-$arch.exe"

$Version = $Version -replace "^v", ""
$base = $env:LICTORY_RUNNER_DOWNLOAD_URL
if (-not $base) {
  if ($Version -eq "latest") { $base = "$repository/releases/latest/download" }
  else { $base = "$repository/releases/download/v$Version" }
}
$label = if ($Version -eq "latest") { "the latest release" } else { $Version }

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("lictory-runner-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
try {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile "$work\SHA256SUMS"
  } catch {
    if ($Version -eq "latest") { Fail "could not download $base/SHA256SUMS. Check the connection, or see $repository/releases." }
    Fail "release v$Version has no lictory-runner files at $base (nightlies are kept for 14 days; a development server has no release). Install the latest stable release instead: rerun without -Version, or with -Version latest."
  }
  $expected = $null
  foreach ($line in Get-Content "$work\SHA256SUMS") {
    $fields = $line -split "\s+", 2
    if ($fields.Count -eq 2 -and $fields[1].TrimStart("*") -eq $asset) { $expected = $fields[0].ToLowerInvariant() }
  }
  if (-not $expected) { Fail "$label has no $asset in its SHA256SUMS." }
  Write-Host "Downloading $asset ($label)..."
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile "$work\lictory-runner.exe"
  $actual = (Get-FileHash -Algorithm SHA256 "$work\lictory-runner.exe").Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Fail "$asset does not match the release's SHA256SUMS (expected $expected, got $actual). Nothing was installed."
  }

  if (-not $InstallDir) {
    $localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME "AppData\Local" }
    $InstallDir = Join-Path $localAppData "Programs\lictory-runner"
  }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $binary = Join-Path $InstallDir "lictory-runner.exe"
  $upgrade = Test-Path $binary
  # A running runner keeps its file open: move it aside instead of
  # overwriting it, and remove what an earlier upgrade moved aside.
  Remove-Item -Force -ErrorAction SilentlyContinue "$binary.old"
  if ($upgrade) { Move-Item -Force $binary "$binary.old" }
  Move-Item -Force "$work\lictory-runner.exe" $binary
  $installed = & $binary --version
  if ($LASTEXITCODE -ne 0) { Fail "$binary does not run on this computer." }
  Write-Host "Installed lictory-runner $installed at $binary."
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $work
}

# On the user's PATH for new terminals, and for this one.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($userPath -split ";") -contains $InstallDir)) {
  $joined = if ($userPath) { "$userPath;$InstallDir" } else { $InstallDir }
  [Environment]::SetEnvironmentVariable("Path", $joined, "User")
  Write-Host "Added $InstallDir to your PATH (new terminals pick it up)."
}
if (-not (($env:Path -split ";") -contains $InstallDir)) { $env:Path = "$env:Path;$InstallDir" }

if ($Url) {
  $arguments = @("register", "--url", $Url, "--token", $Token)
  if ($Name) { $arguments += @("--name", $Name) }
  & $binary @arguments
  if ($LASTEXITCODE -ne 0) { Fail "registration failed (see above)." }
  if ($Service) {
    & $binary install-service
    if ($LASTEXITCODE -ne 0) { Fail "install-service failed (see above)." }
  }
} elseif ($upgrade) {
  Write-Host ""
  Write-Host "A runner that is running keeps the old version until it restarts."
} else {
  Write-Host ""
  Write-Host "Register it with a token from Factory > Runners > Add runner:"
  Write-Host "  lictory-runner register --url <server> --token <token>"
  Write-Host "  lictory-runner install-service"
}
