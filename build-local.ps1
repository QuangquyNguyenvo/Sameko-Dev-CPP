# Sameko Dev C++ - Local Build Script
# Tạo: Installer + Portable ZIP + latest.yml cho auto-update

param(
    [switch]$SkipBuild,
    [switch]$OpenFolder
)

$ErrorActionPreference = "Stop"

# ===== CONFIG =====
$version = (Get-Content "package.json" | ConvertFrom-Json).version
$outputDir = "release_build"
$portableFolderName = "Sameko Dev C++ Portable"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Sameko Dev C++ Local Build v$version" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ===== STEP 1: Verify Sameko-GCC exists =====
Write-Host "[1/6] Checking Sameko-GCC..." -ForegroundColor Yellow
$gccPath = "Sameko-GCC/bin/g++.exe"
if (-not (Test-Path $gccPath)) {
    Write-Host "ERROR: Sameko-GCC not found at: $gccPath" -ForegroundColor Red
    Write-Host "Please ensure Sameko-GCC folder is in project root!" -ForegroundColor Red
    exit 1
}
$gccVersion = & "Sameko-GCC/bin/g++.exe" --version | Select-Object -First 1
Write-Host "  Found: $gccVersion" -ForegroundColor Green

# ===== STEP 2: Clean previous build =====
Write-Host "[2/6] Cleaning previous build..." -ForegroundColor Yellow
if (Test-Path $outputDir) {
    Remove-Item -Recurse -Force $outputDir -ErrorAction SilentlyContinue
}
Write-Host "  Done" -ForegroundColor Green

# ===== STEP 3: Build with electron-builder =====
if (-not $SkipBuild) {
    Write-Host "[3/6] Building with electron-builder..." -ForegroundColor Yellow
    Write-Host "  This may take a few minutes..." -ForegroundColor Gray
    
    # Build both NSIS and create win-unpacked (skip portable.exe)
    npm run build:win -- --win nsis --publish never
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Build completed" -ForegroundColor Green
} else {
    Write-Host "[3/6] Skipping build (using existing)..." -ForegroundColor Yellow
}

# ===== STEP 4: Verify Sameko-GCC in build =====
Write-Host "[4/6] Verifying Sameko-GCC in build..." -ForegroundColor Yellow
$unpackedDir = "$outputDir/win-unpacked"
$gccInBuild = "$unpackedDir/resources/Sameko-GCC/bin/g++.exe"

if (-not (Test-Path $gccInBuild)) {
    Write-Host "ERROR: Sameko-GCC not found in build!" -ForegroundColor Red
    Write-Host "  Expected at: $gccInBuild" -ForegroundColor Red
    Write-Host ""
    Write-Host "Checking resources folder:" -ForegroundColor Yellow
    Get-ChildItem "$unpackedDir/resources" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  - $($_.Name)" }
    exit 1
}
Write-Host "  Sameko-GCC verified in build" -ForegroundColor Green

# ===== STEP 5: Create Portable ZIP =====
Write-Host "[5/6] Creating Portable ZIP..." -ForegroundColor Yellow

$tempRoot = "$outputDir/temp-portable"
$targetPath = "$tempRoot/$portableFolderName"
$zipName = "$outputDir/sameko-dev-cpp-$version-portable.zip"

# Clean temp
if (Test-Path $tempRoot) {
    Remove-Item -Recurse -Force $tempRoot
}

# Copy with folder structure
Copy-Item -Path $unpackedDir -Destination $targetPath -Recurse

# Create ZIP
Compress-Archive -Path $targetPath -DestinationPath $zipName -Force

# Get sizes
$zipSize = [math]::Round((Get-Item $zipName).Length / 1MB, 2)
Write-Host "  Created: $zipName ($zipSize MB)" -ForegroundColor Green

# Keep portable folder for testing
$portableTestDir = "$outputDir/$portableFolderName"
if (Test-Path $portableTestDir) {
    Remove-Item -Recurse -Force $portableTestDir
}
Move-Item -Path $targetPath -Destination $portableTestDir
Remove-Item -Recurse -Force $tempRoot

Write-Host "  Portable folder: $portableTestDir" -ForegroundColor Green

# ===== STEP 6: Verify latest.yml =====
Write-Host "[6/6] Checking latest.yml..." -ForegroundColor Yellow
$latestYml = "$outputDir/latest.yml"
if (Test-Path $latestYml) {
    Write-Host "  latest.yml exists (for auto-update)" -ForegroundColor Green
} else {
    Write-Host "  WARNING: latest.yml not found" -ForegroundColor Yellow
}

# ===== SUMMARY =====
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BUILD COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Output files:" -ForegroundColor White

$files = @(
    @{ Name = "Installer"; Path = "$outputDir/sameko-dev-cpp-setup-$version.exe" },
    @{ Name = "Portable ZIP"; Path = $zipName },
    @{ Name = "Portable Folder"; Path = $portableTestDir },
    @{ Name = "Auto-update"; Path = $latestYml }
)

foreach ($file in $files) {
    if (Test-Path $file.Path) {
        $size = ""
        $item = Get-Item $file.Path
        if (-not $item.PSIsContainer) {
            $size = " ($([math]::Round($item.Length / 1MB, 2)) MB)"
        }
        Write-Host "  [OK] $($file.Name): $($file.Path)$size" -ForegroundColor Green
    } else {
        Write-Host "  [X]  $($file.Name): NOT FOUND" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "To test portable version:" -ForegroundColor Yellow
Write-Host "  cd `"$portableTestDir`"" -ForegroundColor Gray
Write-Host "  .\'Sameko Dev C++.exe'" -ForegroundColor Gray
Write-Host ""

# Open folder if requested
if ($OpenFolder) {
    explorer.exe $outputDir
}
