import { readFile, stat } from "node:fs/promises"
import path from "node:path"

const distDir = path.resolve("dist")
const indexHtmlPath = path.join(distDir, "index.html")
const maxMainChunkBytes = Number(process.env.XIRANITE_MAIN_CHUNK_MAX_BYTES ?? 520_000)

const heavyInitialAssetPatterns = [
  /FlowCanvasView/i,
  /BlockNoteEditor/i,
  /DatabaseDataView/i,
  /vendor-tldraw/i,
  /vendor-blocknote/i,
  /vendor-ocean-dataview/i,
]

const html = await readFile(indexHtmlPath, "utf8")
const initialAssets = [
  ...extractAttributeValues(html, "script", "src"),
  ...extractAttributeValues(html, "link", "href").filter((href) => {
    const tag = findTagForAttribute(html, "link", "href", href)
    return /\brel=["'](?:modulepreload|stylesheet)["']/i.test(tag)
  }),
]

const errors: string[] = []
const heavyInitialAssets = initialAssets.filter((asset) =>
  heavyInitialAssetPatterns.some((pattern) => pattern.test(asset)),
)
if (heavyInitialAssets.length) {
  errors.push(`Heavy lazy assets must not be referenced by dist/index.html: ${heavyInitialAssets.join(", ")}`)
}

const mainScripts = extractAttributeValues(html, "script", "src").filter((src) => src.includes("/assets/"))
for (const src of mainScripts) {
  const filePath = assetPath(src)
  const size = (await stat(filePath)).size
  if (size > maxMainChunkBytes) {
    errors.push(`Initial script ${src} is ${size} bytes, above ${maxMainChunkBytes} bytes.`)
  }
}

if (errors.length) {
  for (const error of errors) console.error(error)
  process.exit(1)
}

console.log(`Build chunk audit passed: ${mainScripts.length} initial script(s), ${initialAssets.length} initial asset reference(s).`)

function extractAttributeValues(htmlText: string, tagName: string, attributeName: string): string[] {
  const values: string[] = []
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi")
  for (const match of htmlText.matchAll(tagPattern)) {
    const tag = match[0]
    const attributePattern = new RegExp(`\\b${attributeName}=["']([^"']+)["']`, "i")
    const attributeMatch = tag.match(attributePattern)
    if (attributeMatch?.[1]) values.push(attributeMatch[1])
  }
  return values
}

function findTagForAttribute(htmlText: string, tagName: string, attributeName: string, value: string): string {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi")
  for (const match of htmlText.matchAll(tagPattern)) {
    const tag = match[0]
    if (tag.includes(`${attributeName}="${value}"`) || tag.includes(`${attributeName}='${value}'`)) return tag
  }
  return ""
}

function assetPath(assetUrl: string): string {
  const clean = assetUrl.replace(/^\//, "")
  return path.join(distDir, clean.startsWith("assets/") ? clean : path.basename(clean))
}
