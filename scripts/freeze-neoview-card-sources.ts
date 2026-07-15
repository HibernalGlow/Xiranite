import { readFile, writeFile } from "node:fs/promises"
import { relative, resolve } from "node:path"

interface CardEntry {
  legacyId: string
  sourceComponent?: string
  sourceDisposition?: "component" | "registry-only"
  sourceNotes?: string
  [key: string]: unknown
}

interface CardMatrix {
  cards: CardEntry[]
  [key: string]: unknown
}

const root = resolve(import.meta.dir, "..")
const sourceRoot = resolve(root, process.env.NEOVIEW_SOURCE_ROOT ?? "../ImageAll/NeeWaifu/neoview/neoview-tauri")
const rendererPath = resolve(sourceRoot, "src/lib/cards/CardRenderer.svelte")
const matrixPath = resolve(root, "migration/neoview/card-compatibility.json")
const renderer = await readFile(rendererPath, "utf8")
const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as CardMatrix
const mappings = new Map(
  [...renderer.matchAll(/^\s*([A-Za-z0-9_]+):\s*\(\)\s*=>\s*import\('([^']+)'\)/gm)]
    .map((match) => [match[1]!, `src/lib/cards/${match[2]!.replace(/^\.\//, "")}`]),
)

for (const card of matrix.cards) {
  const sourceComponent = mappings.get(card.legacyId)
  if (sourceComponent) {
    card.sourceComponent = sourceComponent
    card.sourceDisposition = "component"
    delete card.sourceNotes
  } else {
    delete card.sourceComponent
    card.sourceDisposition = "registry-only"
    card.sourceNotes = "旧 CardRenderer 没有组件映射；迁移前必须显式补齐或记录替代决策。"
  }
}

await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`, "utf8")
console.log(JSON.stringify({
  source: relative(root, rendererPath).replaceAll("\\", "/"),
  cards: matrix.cards.length,
  components: mappings.size,
  registryOnly: matrix.cards.filter((card) => card.sourceDisposition === "registry-only").map((card) => card.legacyId),
}, null, 2))
