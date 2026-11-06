# FilmForge - Package with Memory System

$ErrorActionPreference = "Stop"

Write-Host "==================================="
Write-Host "FilmForge Memory System Packaging"
Write-Host "==================================="
Write-Host ""

$ProjectRoot = $PSScriptRoot
$ReleaseDir = Join-Path $ProjectRoot "release-2026-10-28-b"
$MemoryDir = Join-Path $ReleaseDir "FilmForgeData\memory-system"
$UnpackedDir = Join-Path $ReleaseDir "win-unpacked"
$OutputDir = Join-Path $ProjectRoot "release-final"

Write-Host "[1/5] Checking directories..."
if (-not (Test-Path $ReleaseDir)) { Write-Host "ERROR: Release not found"; exit 1 }
if (-not (Test-Path $MemoryDir)) { Write-Host "ERROR: Memory system not found"; exit 1 }
if (-not (Test-Path $UnpackedDir)) { Write-Host "ERROR: win-unpacked not found"; exit 1 }
Write-Host "OK: All directories found"
Write-Host ""

Write-Host "[2/5] Creating output directory..."
if (Test-Path $OutputDir) { Remove-Item -Path $OutputDir -Recurse -Force }
New-Item -Path $OutputDir -ItemType Directory | Out-Null
New-Item -Path "$OutputDir\win-unpacked" -ItemType Directory | Out-Null
Write-Host "OK: Output directory created"
Write-Host ""

Write-Host "[3/5] Copying unpacked app..."
Copy-Item -Path "$UnpackedDir\*" -Destination "$OutputDir\win-unpacked\" -Recurse -Force
Write-Host "OK: App copied"
Write-Host ""

Write-Host "[4/5] Integrating memory system..."
$ResourcesDir = "$OutputDir\win-unpacked\resources"
$MemoryTargetDir = "$ResourcesDir\memory-system"
if (-not (Test-Path $MemoryTargetDir)) { New-Item -Path $MemoryTargetDir -ItemType Directory | Out-Null }
Copy-Item -Path "$MemoryDir\*" -Destination $MemoryTargetDir -Recurse -Force
$FileCount = (Get-ChildItem -Path $MemoryTargetDir -Recurse -File).Count
Write-Host "OK: Memory system integrated ($FileCount files)"
Write-Host ""

Write-Host "[5/5] Copying executables..."
Copy-Item -Path "$ReleaseDir\*.exe" -Destination $OutputDir -Force -ErrorAction SilentlyContinue
Copy-Item -Path "$ReleaseDir\*.blockmap" -Destination $OutputDir -Force -ErrorAction SilentlyContinue
Write-Host "OK: Executables copied"
Write-Host ""

Write-Host "==================================="
Write-Host "BUILD COMPLETED SUCCESSFULLY!"
Write-Host "==================================="
Write-Host ""
Write-Host "Output: $OutputDir"
Write-Host ""
Get-ChildItem -Path $OutputDir -Filter "*.exe" | ForEach-Object {
    $SizeMB = [math]::Round($_.Length / 1MB, 1)
    Write-Host "  $($_.Name) - $SizeMB MB"
}
Write-Host ""
Write-Host "Memory system: resources\memory-system ($FileCount files)"
Write-Host ""

Start-Process explorer.exe -ArgumentList $OutputDir
