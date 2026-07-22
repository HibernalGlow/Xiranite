import { parseSync } from "oxc-parser"

export type LucideExportMap = ReadonlyMap<string, string>

export function collectLucideValueImports(source: string, filename: string): string[] {
  if (!source.includes("lucide-react")) return []
  const cleanFilename = filename.split("?", 1)[0]!
  const lang = cleanFilename.endsWith(".tsx")
    ? "tsx"
    : cleanFilename.endsWith(".ts") ? "ts" : cleanFilename.endsWith(".jsx") ? "jsx" : "js"
  const parsed = parseSync(cleanFilename, source, { lang, sourceType: "module", astType: lang.startsWith("ts") ? "ts" : "js" })
  return parsed.module.staticImports
    .filter((statement) => statement.moduleRequest.value === "lucide-react")
    .flatMap((statement) => statement.entries)
    .filter((entry) => !entry.isType && entry.importName.kind === "Name" && entry.importName.name)
    .map((entry) => entry.importName.name!)
}

export function collectLucideIconExports(source: string): Map<string, string> {
  const exports = new Map<string, string>()
  const parsed = parseSync("lucide-react.js", source, { lang: "js", sourceType: "module", astType: "js" })

  for (const statement of parsed.module.staticExports) {
    for (const entry of statement.entries) {
      const name = entry.exportName.name
      const moduleRequest = entry.moduleRequest?.value
      if (!name || !moduleRequest?.startsWith("./icons/") || !moduleRequest.endsWith(".js")) continue
      exports.set(name, `lucide-react/dist/esm/${moduleRequest.slice(2)}`)
    }
  }

  return exports
}

export function rewriteLucideDeepImports(
  source: string,
  filename: string,
  iconExports: LucideExportMap,
): string | null {
  if (!source.includes("lucide-react")) return null

  const cleanFilename = filename.split("?", 1)[0]!
  const lang = cleanFilename.endsWith(".tsx")
    ? "tsx"
    : cleanFilename.endsWith(".ts") ? "ts" : cleanFilename.endsWith(".jsx") ? "jsx" : "js"
  const parsed = parseSync(cleanFilename, source, { lang, sourceType: "module", astType: lang.startsWith("ts") ? "ts" : "js" })
  const replacements: { start: number; end: number; code: string }[] = []

  for (const statement of parsed.module.staticImports) {
    if (statement.moduleRequest.value !== "lucide-react") continue

    const typeEntries = statement.entries.filter((entry) => entry.isType)
    const valueEntries = statement.entries.filter((entry) => !entry.isType)
    const lines: string[] = []

    if (typeEntries.length) {
      const specifiers = typeEntries.map((entry) => formatNamedImport(entry.importName.name, entry.localName.value))
      lines.push(`import type { ${specifiers.join(", ")} } from "lucide-react"`)
    }

    for (const entry of valueEntries) {
      const imported = entry.importName.name
      if (entry.importName.kind !== "Name" || !imported) {
        throw new Error(`Unsupported lucide-react import in ${cleanFilename}`)
      }
      const modulePath = iconExports.get(imported)
      if (!modulePath) throw new Error(`Unknown lucide-react value export "${imported}" in ${cleanFilename}`)
      lines.push(`import ${entry.localName.value} from ${JSON.stringify(modulePath)}`)
    }

    replacements.push({ start: statement.start, end: statement.end, code: lines.join("\n") })
  }

  if (!replacements.length) return null
  let rewritten = source
  for (const replacement of replacements.toReversed()) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.code}${rewritten.slice(replacement.end)}`
  }
  return rewritten
}

function formatNamedImport(imported: string | null, local: string): string {
  if (!imported) throw new Error(`Unsupported lucide-react type import "${local}"`)
  return imported === local ? imported : `${imported} as ${local}`
}
