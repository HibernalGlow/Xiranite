import type { TransformImportsOptions } from "@rolldown/plugin-transform-imports"

const LUCIDE_BARREL_IMPORT = "lucide-react"
const LUCIDE_TYPE_IMPORT_SOURCE = "lucide-react/dist/esm/lucide-react.mjs"
const LUCIDE_NAMED_IMPORT_PATTERN = /import\s*\{([^}]*)\}\s*from\s*(["'])lucide-react\2[ \t]*;?/g
const LUCIDE_TYPE_IMPORT_PATTERN = /(import\s+type\s+(?:\{[^}]*\}|\*\s+as\s+[\w$]+|[\w$]+)\s+from\s+)(["'])lucide-react\2/g

export const LUCIDE_TRANSFORM_IMPORT_OPTIONS = {
  [LUCIDE_BARREL_IMPORT]: {
    transform: [
      ["PictureInPicture2", "lucide-react/dist/esm/icons/picture-in-picture-2.mjs"],
      ["*", "lucide-react/dist/esm/icons/{{kebabCase member}}.mjs"],
    ],
  },
} satisfies TransformImportsOptions

/** Keep type-only bindings out of the value-import transform's exact module match. */
export function protectLucideTypeImports(source: string): string | null {
  if (!source.includes(LUCIDE_BARREL_IMPORT)) return null

  const separatedMixedImports = source.replace(
    LUCIDE_NAMED_IMPORT_PATTERN,
    (statement, rawSpecifiers: string, quote: string) => {
      const specifiers = rawSpecifiers.split(",").map((specifier) => specifier.trim()).filter(Boolean)
      const typeSpecifiers = specifiers
        .filter((specifier) => specifier.startsWith("type "))
        .map((specifier) => specifier.slice("type ".length).trim())
      if (!typeSpecifiers.length) return statement

      const valueSpecifiers = specifiers.filter((specifier) => !specifier.startsWith("type "))
      const typeImport = `import type { ${typeSpecifiers.join(", ")} } from ${quote}${LUCIDE_TYPE_IMPORT_SOURCE}${quote};`
      if (!valueSpecifiers.length) return typeImport
      return `${typeImport}\nimport { ${valueSpecifiers.join(", ")} } from ${quote}${LUCIDE_BARREL_IMPORT}${quote};`
    },
  )
  const rewritten = separatedMixedImports.replace(
    LUCIDE_TYPE_IMPORT_PATTERN,
    `$1$2${LUCIDE_TYPE_IMPORT_SOURCE}$2`,
  )

  return rewritten === source ? null : rewritten
}
