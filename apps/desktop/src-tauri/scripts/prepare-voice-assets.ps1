param(
  [Parameter(Mandatory = $true)]
  [string]$FeasibilityRoot
)

$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $PSScriptRoot '..\voice-assets-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$runtimeRoot = Join-Path $FeasibilityRoot 'build-static\bin\Release'
$modelPath = Join-Path $FeasibilityRoot 'ggml-base.bin'
$licensePath = Join-Path $FeasibilityRoot 'whisper.cpp\LICENSE'
$modelCardPath = Join-Path $FeasibilityRoot 'model-card-README.md'
$nativeRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$assetsRoot = Join-Path $nativeRoot 'voice-assets'
$binaryRoot = Join-Path $nativeRoot 'binaries'

function Assert-PinnedFile([string]$Path, [long]$Bytes, [string]$Sha256) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Pinned voice input is missing: $Path" }
  $item = Get-Item -LiteralPath $Path
  if ($Bytes -gt 0 -and $item.Length -ne $Bytes) { throw "Pinned voice input has unexpected size: $Path" }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Sha256) { throw "Pinned voice input has unexpected SHA-256: $Path" }
}

Assert-PinnedFile (Join-Path $runtimeRoot $manifest.runtime.binary.name) $manifest.runtime.binary.bytes $manifest.runtime.binary.sha256
foreach ($dll in $manifest.runtime.dlls) {
  Assert-PinnedFile (Join-Path $runtimeRoot $dll.name) $dll.bytes $dll.sha256
}
Assert-PinnedFile $modelPath $manifest.model.bytes $manifest.model.sha256
Assert-PinnedFile $licensePath 0 $manifest.notices[0].sha256
Assert-PinnedFile $modelCardPath 0 $manifest.notices[1].sha256

New-Item -ItemType Directory -Path $assetsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $binaryRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $runtimeRoot $manifest.runtime.binary.name) -Destination (Join-Path $binaryRoot 'whisper-cli-x86_64-pc-windows-msvc.exe') -Force
foreach ($dll in $manifest.runtime.dlls) { Copy-Item -LiteralPath (Join-Path $runtimeRoot $dll.name) -Destination (Join-Path $assetsRoot $dll.name) -Force }
Copy-Item -LiteralPath $modelPath -Destination (Join-Path $assetsRoot $manifest.model.name) -Force
Copy-Item -LiteralPath $licensePath -Destination (Join-Path $assetsRoot 'WHISPER-LICENSE.txt') -Force
Copy-Item -LiteralPath $modelCardPath -Destination (Join-Path $assetsRoot 'MODEL-CARD.txt') -Force
Write-Output "Pinned voice assets staged and verified at $assetsRoot"
