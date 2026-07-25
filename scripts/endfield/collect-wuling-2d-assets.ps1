[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExportRoot,
    [Parameter(Mandatory = $true)]
    [string]$OutputRoot
)

$ErrorActionPreference = "Stop"
$sourceRoot = Join-Path $ExportRoot "recovered\AnimeStudio-cli\StreamingAssets\convert_by_type"
$excludePattern = "(?i)map|enemy|^eny[_-]|palesent|^T_auto_generat"

function Get-Category([string]$Name) {
    if ($Name -match "(?i)char|character|portrait|avatar|profile|illustration|story|loading|login|banner") {
        return "01-characters"
    }
    if ($Name -match "(?i)icon|item|material|weapon|skill|talent|facility|machine|resource|coin|badge|star|rarity") {
        return "02-icons-materials"
    }
    return "03-ui"
}

if (-not (Test-Path -LiteralPath $sourceRoot)) {
    throw "The extracted asset root was not found: $sourceRoot"
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$rows = [System.Collections.Generic.List[object]]::new()

foreach ($kind in @("Sprite", "Texture2D")) {
    $sourceDirectory = Join-Path $sourceRoot $kind
    if (-not (Test-Path -LiteralPath $sourceDirectory)) { continue }

    foreach ($sourceFile in Get-ChildItem -LiteralPath $sourceDirectory -Filter "*.png" -File) {
        if ($sourceFile.Name -match $excludePattern) { continue }

        $category = Get-Category $sourceFile.Name
        $destinationDirectory = Join-Path $OutputRoot "$category\$($kind.ToLowerInvariant())"
        New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
        $destinationFile = Join-Path $destinationDirectory $sourceFile.Name
        if (-not (Test-Path -LiteralPath $destinationFile)) {
            New-Item -ItemType HardLink -Path $destinationFile -Target $sourceFile.FullName | Out-Null
        }

        $rows.Add([pscustomobject]@{
            category = $category
            kind = $kind
            name = $sourceFile.Name
            bytes = $sourceFile.Length
            source = $sourceFile.FullName
        })
    }
}

$rows | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $OutputRoot "selection-manifest.csv")
$rows | Group-Object category, kind | ForEach-Object { "{0}: {1}" -f $_.Name, $_.Count }
"total=$($rows.Count)"
