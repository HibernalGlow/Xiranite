/**
 * Generates `crates/xiranite-tui-runtime/src/theme.rs` from the theme table the TUI uses today, and gates it.
 *
 * Why generated rather than transcribed: the palette list is 40 themes × 8 sRGB tokens of hex text. Hand-copying
 * that into Rust is exactly the vocabulary that silently loses an entry or gains a typo, and a wrong `focusRing`
 * is invisible in a screenshot review. `packages/cli-runtime/src/tui/theme.tsx` is the producer, so this script
 * asks it through its own `listTerminalThemes()` / `resolveTerminalTheme()` and writes down the answer.
 *
 * It also carries the two behaviours that are easy to lose in a port and are asserted in the generated file: the
 * fallback theme is **nord** (not the palette literally named `default`), and an unknown name resolves to nord
 * rather than failing.
 *
 * `bun run audit:tui-theme-table` fails on drift; `bun run migrate:tui-theme-table` rewrites the Rust table.
 */
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const TOKEN_KEYS = ["primary", "foreground", "mutedForeground", "border", "focusRing", "success", "warning", "error"] as const
const RUST_FIELDS = ["primary", "foreground", "muted_foreground", "border", "focus_ring", "success", "warning", "error"] as const

export type Rgba = [number, number, number, number]

export interface ThemeEntry {
  name: string
  tokens: Record<(typeof TOKEN_KEYS)[number], Rgba>
}

/**
 * `#rrggbb`, optionally with alpha.
 *
 * The alpha is not decoration: the producer's `cursor` theme writes `#e4e4e45e` for `mutedForeground` and
 * `border`, and ratatui cannot express a translucent foreground at all. Carrying the byte through keeps that
 * loss visible in the port instead of having it happen during a silent transcription.
 */
export function parseHexColour(hex: string, theme: string, token: string): Rgba {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i.exec(hex.trim())
  if (!match) throw new Error(`theme ${theme}: ${token} = ${JSON.stringify(hex)} is not a #rrggbb or #rrggbbaa colour`)
  return [
    Number.parseInt(match[1] ?? "", 16),
    Number.parseInt(match[2] ?? "", 16),
    Number.parseInt(match[3] ?? "", 16),
    Number.parseInt(match[4] ?? "ff", 16),
  ]
}

/** The producer is TSX with a React import; bun loads it and the two exported functions are its API. */
export async function readThemeTable(): Promise<ThemeEntry[]> {
  const module = await import("../packages/cli-runtime/src/tui/theme.tsx")
  const names = module.listTerminalThemes() as string[]
  if (names.length === 0) throw new Error("listTerminalThemes() answered with nothing: the scan is broken, not the theme table.")
  return names.map((name) => {
    const colors = module.resolveTerminalTheme(name).colors as Record<string, string>
    const tokens = {} as ThemeEntry["tokens"]
    for (const key of TOKEN_KEYS) tokens[key] = parseHexColour(colors[key] ?? "", name, key)
    return { name, tokens }
  })
}

const paletteLiteral = (entry: ThemeEntry): string => {
  const values = TOKEN_KEYS.map((key) => {
    const [red, green, blue, alpha] = entry.tokens[key]
    return `(${red}, ${green}, ${blue}, ${alpha})`
  })
  return `Some(Palette { ${RUST_FIELDS.map((field, index) => `${field}: ${values[index]}`).join(", ")} })`
}

const TEST_BLOCK = `#[cfg(test)]
mod tests {
    use super::{fallback_theme, palette, resolve_theme_name, theme_names};

    #[test]
    fn every_theme_in_the_table_has_a_palette() {
        for name in theme_names() {
            assert!(palette(name).is_some(), "{name} is listed but has no palette");
        }
        assert!(theme_names().len() >= 40, "the producer registered fewer themes than before: {}", theme_names().len());
    }

    #[test]
    fn matching_ignores_case_and_surrounding_space() {
        assert_eq!(palette("Nord"), palette("  nord "));
        assert!(palette("torak").is_none(), "an invented theme must not resolve to a palette");
        // The one translucent entry in the producer, kept as it was authored rather than flattened to opaque.
        let cursor = palette("cursor").expect("cursor theme");
        assert!(cursor.muted_foreground.3 < 255, "cursor's muted foreground carries alpha: {cursor:?}");
        assert_eq!(palette("nord").map(|entry| entry.primary), Some((136, 192, 208, 255)));
    }

    #[test]
    fn the_fallback_is_nord_and_an_unknown_name_falls_back_to_it() {
        assert_eq!(fallback_theme(), "nord");
        assert_eq!(resolve_theme_name(None), "nord");
        assert_eq!(resolve_theme_name(Some("not-a-theme")), "nord");
        assert_eq!(resolve_theme_name(Some("   ")), "nord");
        // The palette literally named "default" is a colour scheme, not the fallback theme: a port that reads the
        // first row as "the default" would recolour every screen.
        assert!(theme_names().contains(&"default"));
        assert_ne!(fallback_theme(), "default");
        assert_eq!(resolve_theme_name(Some(" Dracula ")), "dracula");
        assert_eq!(resolve_theme_name(Some("HIGH-CONTRAST")), "high-contrast");
    }
}
`

export function renderRustTable(entries: ThemeEntry[]): string {
  return `//! Generated by \`scripts/audit-tui-theme-table.ts\` from \`packages/cli-runtime/src/tui/theme.tsx\`.
//! Do not edit by hand: \`bun run audit:tui-theme-table\` fails when this file and the producer disagree, and
//! \`bun run migrate:tui-theme-table\` rewrites it. The producer's own meaning is preserved: the fallback theme is
//! \`nord\` (not the palette named \`default\`), and an unknown name resolves to the fallback instead of failing.

/// One palette entry: eight sRGB colours with their alpha byte, so this crate stays free of any terminal
/// dependency. A face that cannot draw alpha (ratatui cannot) must decide what to do with the last byte and
/// say so — the "cursor" theme is translucent on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Palette {
${RUST_FIELDS.map((field) => `    pub ${field}: (u8, u8, u8, u8),`).join("\n")}
}

/// Every theme the legacy TUI registers, in its own order.
#[must_use]
pub const fn theme_names() -> &'static [&'static str] {
    &[${entries.map((entry) => JSON.stringify(entry.name)).join(", ")}]
}

/// The palette for a theme name, matched the way \`resolveTerminalTheme\` matches it.
#[must_use]
pub fn palette(name: &str) -> Option<Palette> {
    match name.trim().to_ascii_lowercase().as_str() {
${entries.map((entry) => `        ${JSON.stringify(entry.name)} => ${paletteLiteral(entry)},`).join("\n")}
        _ => None,
    }
}

/// The theme the screen falls back to, and the answer for a name it does not know.
#[must_use]
pub const fn fallback_theme() -> &'static str {
    "nord"
}

/// Resolve an optional theme name exactly like the TypeScript does: absent, empty or unknown → nord.
#[must_use]
pub fn resolve_theme_name(name: Option<&str>) -> &'static str {
    let requested = name.map(str::trim).filter(|value| !value.is_empty()).map(|value| value.to_ascii_lowercase());
    match requested.as_deref() {
        Some(looked_up) => theme_names().iter().find(|candidate| **candidate == looked_up).copied().unwrap_or_else(fallback_theme),
        None => fallback_theme(),
    }
}

${TEST_BLOCK}`
}

const repoRoot = join(import.meta.dir, "..")
const targetPath = join(repoRoot, "crates", "xiranite-tui-runtime", "src", "theme.rs")

/** The theme names as they appear in a generated file, for a readable drift report. */
export function namesInRustTable(text: string): string[] {
  return [...text.matchAll(/^ {8}"([\w-]+)" => Some\(Palette/gm)].map((match) => match[1] ?? "")
}

/**
 * Per-theme palette literals, so a colour that changed without any name moving is reported as that colour and
 * not as an empty "nothing added, nothing removed".
 */
export function palettesInRustTable(text: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of text.matchAll(/^ {8}"([\w-]+)" => (.*),$/gm)) {
    if (match[1]) found.set(match[1], match[2] ?? "")
  }
  return found
}

/** The human-readable difference: renamed entries plus up to eight changed palettes. */
export function describeThemeDrift(before: string, after: string): string[] {
  const beforeNames = namesInRustTable(before)
  const afterNames = namesInRustTable(after)
  const lines: string[] = []
  const added = afterNames.filter((name) => !beforeNames.includes(name))
  const removed = beforeNames.filter((name) => !afterNames.includes(name))
  if (added.length > 0) lines.push(`themes added by the producer: ${added.join(", ")}`)
  if (removed.length > 0) lines.push(`themes gone from the producer: ${removed.join(", ")}`)
  const beforePalettes = palettesInRustTable(before)
  const afterPalettes = palettesInRustTable(after)
  const changed = afterNames.filter((name) => beforePalettes.get(name) !== afterPalettes.get(name))
  for (const name of changed.slice(0, 8)) {
    lines.push(`palette changed for ${name}: table has ${beforePalettes.get(name) ?? "(absent)"}; producer says ${afterPalettes.get(name) ?? "(absent)"}`)
  }
  if (changed.length > 8) lines.push(`...and ${changed.length - 8} more changed palettes`)
  return lines
}

if (import.meta.main) {
  const entries = await readThemeTable()
  const rendered = renderRustTable(entries)
  const current = await readFile(targetPath, "utf8").catch(() => null)

  if (process.argv.includes("--write") || current === null) {
    await writeFile(targetPath, rendered, "utf8")
    console.log(`tui theme table: wrote ${entries.length} themes to crates/xiranite-tui-runtime/src/theme.rs`)
  } else if (current !== rendered) {
    const lines = describeThemeDrift(current, rendered)
    for (const line of lines) console.error(`FAIL  ${line}`)
    if (lines.length === 0) console.error("FAIL  the generated file differs from the producer in some other way (formatting or a hand edit).")
    console.error("      run: bun run migrate:tui-theme-table, then review the diff.")
    throw new Error(`audit:tui-theme-table found ${lines.length || 1} difference(s) between packages/cli-runtime/src/tui/theme.tsx and crates/xiranite-tui-runtime/src/theme.rs.`)
  } else {
    console.log(`OK tui theme table: ${entries.length} themes match the producer.`)
  }
}
