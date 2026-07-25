[CmdletBinding()]
param(
    [string]$InputRoot,
    [string]$OutputRoot,
    [switch]$CleanOutput
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $InputRoot) {
    $InputRoot = Join-Path $repoRoot "artifacts\reference\endfield-wuling\02-extracted-2d"
}
if (-not $OutputRoot) {
    $OutputRoot = Join-Path $repoRoot "artifacts\reference\endfield-wuling\03-categorized-by-webui"
}

$categoryRules = @(
    @{ Prefixes = @("pic_"); Category = "character" }
    @{ Prefixes = @("icon_round"); Category = "icon_round" }
    @{ Prefixes = @("icon_"); Category = "icon" }
    @{ Prefixes = @("item_topic"); Category = "item_topic" }
    @{ Prefixes = @("item_potential"); Category = "item_potential" }
    @{ Prefixes = @("item_"); Category = "item" }
    @{ Prefixes = @("business_card"); Category = "business_card" }
    @{ Prefixes = @("sns_"); Category = "sns" }
    @{ Prefixes = @("bg_", "background", "activity_bg"); Category = "background" }
    @{ Prefixes = @("logo"); Category = "logo" }
    @{ Prefixes = @("loading"); Category = "loading" }
    @{ Prefixes = @("tutorial"); Category = "tutorial" }
    @{ Prefixes = @("cg_"); Category = "cg" }
    @{ Prefixes = @("splash"); Category = "splash" }
    @{ Prefixes = @("chr_"); Category = "chr_thumb" }
    @{ Prefixes = @("title"); Category = "title" }
    @{ Prefixes = @("tips"); Category = "tips" }
    @{ Prefixes = @("achv_", "achievement_", "achievement-"); Category = "achievement" }
    @{ Prefixes = @("wpn_", "weapon_", "weapon-"); Category = "weapon" }
    @{ Prefixes = @("activity_"); Category = "activity" }
    @{ Prefixes = @("prts_"); Category = "prts" }
    @{ Prefixes = @("dung", "slu__dung"); Category = "dungeon" }
    @{ Prefixes = @("slu__map"); Category = "map" }
    @{ Prefixes = @("slu__ld"); Category = "level" }
    @{ Prefixes = @("slu__"); Category = "snapshot" }
    @{ Prefixes = @("dlg_"); Category = "dialog" }
    @{ Prefixes = @("gacha"); Category = "gacha" }
    @{ Prefixes = @("image_", "img_", "img-"); Category = "image" }
    @{ Prefixes = @("deco_", "deco-", "line_", "line-"); Category = "decoration" }
    @{ Prefixes = @("btn_", "btn-"); Category = "button" }
    @{ Prefixes = @("common_", "common-"); Category = "common_ui" }
    @{ Prefixes = @("uisprite"); Category = "ui_sprite" }
    @{ Prefixes = @("emoji_", "emoji-"); Category = "emoji" }
    @{ Prefixes = @("guide_", "guide-"); Category = "guide" }
    @{ Prefixes = @("tech_", "tech-"); Category = "tech" }
    @{ Prefixes = @("eny_", "eny-", "enemy_", "enemy-"); Category = "enemy" }
    @{ Prefixes = @("wiki_", "wiki-"); Category = "wiki" }
    @{ Prefixes = @("shop_", "shop-", "monthlypass"); Category = "shop" }
    @{ Prefixes = @("map_", "map-"); Category = "map" }
    @{ Prefixes = @("collection_", "collection-"); Category = "collection" }
    @{ Prefixes = @("document_", "document-"); Category = "document" }
    @{ Prefixes = @("seasonal_", "seasonal-"); Category = "seasonal" }
    @{ Prefixes = @("textfactorycommonui"); Category = "factory_ui" }
    @{ Prefixes = @("dwr_", "dwr-"); Category = "dwr" }
    @{ Prefixes = @("facskill_", "facskill-"); Category = "factory_skill" }
    @{ Prefixes = @("aibark_", "aibark-"); Category = "aibark" }
    @{ Prefixes = @("reception_", "reception-"); Category = "reception" }
    @{ Prefixes = @("racing_", "racing-"); Category = "racing" }
    @{ Prefixes = @("remotecomm_", "remotecomm-"); Category = "remotecomm" }
    @{ Prefixes = @("potential_"); Category = "item_potential" }
    @{ Prefixes = @("boss_", "boss-"); Category = "boss" }
    @{ Prefixes = @("snapshot_", "snapshot-"); Category = "snapshot" }
    @{ Prefixes = @("poster_", "poster-"); Category = "poster" }
    @{ Prefixes = @("adventure_", "adventure-"); Category = "adventure" }
    @{ Prefixes = @("mail_", "mail-"); Category = "mail" }
    @{ Prefixes = @("chapter_", "chapter-"); Category = "chapter" }
    @{ Prefixes = @("cover_", "cover-"); Category = "cover" }
    @{ Prefixes = @("reading_", "reading-"); Category = "reading" }
    @{ Prefixes = @("text_", "text-"); Category = "text" }
    @{ Prefixes = @("ui_", "ui-"); Category = "ui" }
    @{ Prefixes = @("prgs_", "prgs-"); Category = "progress" }
    @{ Prefixes = @("decal_", "decal-"); Category = "decal" }
)

function Get-CategoryFolder([string]$Category) {
    if ($Category -eq "other") { return "Other" }
    return (($Category -replace "[_-]+", " ") -split " " | ForEach-Object {
        if ($_ -in @("ui", "cg", "sns", "prts", "dwr")) { $_.ToUpperInvariant() }
        elseif ($_) { $_.Substring(0, 1).ToUpperInvariant() + $_.Substring(1) }
    }) -join " "
}

function Get-AssetCategory([string]$Name) {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($Name).ToLowerInvariant()
    $stem = $stem -replace "_p[0-9a-f]{16}$", ""
    $candidates = @($stem)
    if ($stem -match "^[a-z]_(.+)$") {
        $candidates += $Matches[1]
    }

    foreach ($candidate in $candidates) {
        foreach ($rule in $categoryRules) {
            foreach ($prefix in $rule.Prefixes) {
                if ($candidate.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
                    return $rule.Category
                }
            }
        }
        if ($candidate -match "(^|[_-])boss([_-]|$)") { return "boss" }
        if ($candidate -match "(^|[_-])enemy([_-]|$)") { return "enemy" }
        if ($candidate.StartsWith("map02") -or $candidate.StartsWith("map03")) { return "map" }
    }
    return "other"
}

function Get-AssetKind([System.IO.FileInfo]$File) {
    $relative = $File.FullName.Substring($InputRoot.Length).TrimStart([char[]]"\/")
    $first = ($relative -split "[\\/]")[0].ToLowerInvariant()
    if ($first -eq "sprite") { return "Sprite" }
    if ($first -eq "texture2d") { return "Texture2D" }
    return "Other"
}

if (-not (Test-Path -LiteralPath $InputRoot -PathType Container)) {
    throw "Input directory was not found: $InputRoot"
}
$InputRoot = (Resolve-Path -LiteralPath $InputRoot).Path.TrimEnd("\\")

if ($CleanOutput -and (Test-Path -LiteralPath $OutputRoot)) {
    $resolvedOutput = (Resolve-Path -LiteralPath $OutputRoot).Path.TrimEnd("\\")
    $allowedRoot = (Resolve-Path (Join-Path $repoRoot "artifacts\reference\endfield-wuling")).Path.TrimEnd("\\")
    if ($resolvedOutput -eq $allowedRoot -or -not $resolvedOutput.StartsWith("$allowedRoot\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean outside the Endfield reference directory: $resolvedOutput"
    }
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$rows = [System.Collections.Generic.List[object]]::new()
$collisions = [System.Collections.Generic.List[string]]::new()

foreach ($file in Get-ChildItem -LiteralPath $InputRoot -Recurse -File -Filter "*.png") {
    $category = Get-AssetCategory $file.Name
    if ($category -in @("map", "enemy")) { continue }
    $kind = Get-AssetKind $file
    $folder = Get-CategoryFolder $category
    $destinationDirectory = Join-Path $OutputRoot "$folder\$kind"
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    $destinationFile = Join-Path $destinationDirectory $file.Name

    if (Test-Path -LiteralPath $destinationFile) {
        $existing = Get-Item -LiteralPath $destinationFile
        if ($existing.Length -ne $file.Length) {
            $collisions.Add($destinationFile)
            continue
        }
    } else {
        New-Item -ItemType HardLink -Path $destinationFile -Target $file.FullName | Out-Null
    }

    $rows.Add([pscustomobject]@{
        category = $folder
        webuiCategory = $category
        kind = $kind
        name = $file.Name
        bytes = $file.Length
        source = $file.FullName
        destination = $destinationFile
    })
}

$manifestPath = Join-Path $OutputRoot "classification-manifest.csv"
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $manifestPath
$rows | Group-Object category | Sort-Object Name | ForEach-Object {
    "{0}: {1}" -f $_.Name, $_.Count
}
"total=$($rows.Count)"
if ($collisions.Count) {
    "collisions=$($collisions.Count)"
    $collisions | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $OutputRoot "collisions.txt")
}
