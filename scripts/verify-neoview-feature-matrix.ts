import { spawnSync } from "node:child_process"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

interface FeatureEntry {
  id: string
  title: string
  legacySourcePatterns: string[]
  legacyCommandPatterns: string[]
  settingsKeys: string[]
  dataStores: string[]
  surfaces: Array<"gui" | "cli" | "tui">
  status: "pending" | "preserved" | "host-replaced" | "import-only" | "removed-with-approval"
  behaviorCases: string[]
  testIds: string[]
  benchmarkIds: string[]
  knownDifferences: string[]
}

interface Matrix {
  schemaVersion: number
  sourceRevision: string
  statusValues: string[]
  features: FeatureEntry[]
}

interface Baseline {
  sourceRevision: { commit: string | null }
  commands: Array<{ name: string; location: { file: string; line: number } }>
}

const matrixPath = resolve("migration/neoview/feature-compatibility.json")
const baselinePath = resolve("migration/neoview/inventory-baseline.json")
const checklistPath = resolve("docs/neoview-feature-checklist.md")
const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as Matrix
const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as Baseline
const source = resolve(process.env.NEOVIEW_SOURCE ?? "../ImageAll/NeeWaifu/neoview/neoview-tauri")

const errors: string[] = []
if (matrix.schemaVersion !== 1) errors.push(`Unsupported matrix schema: ${matrix.schemaVersion}`)
if (matrix.sourceRevision !== baseline.sourceRevision.commit) {
  errors.push(`Matrix revision ${matrix.sourceRevision} differs from inventory ${baseline.sourceRevision.commit}`)
}

const head = git(["rev-parse", "HEAD"]).trim()
if (head !== matrix.sourceRevision) errors.push(`NeoView HEAD ${head} differs from matrix ${matrix.sourceRevision}`)
const sourceFiles = git(["ls-files"]).split(/\r?\n/).filter(Boolean)
const testCorpus = await readTestCorpus([
  resolve("packages/nodes/neoview"),
  resolve("packages/backend/src"),
  resolve("src/nodes/neoview"),
  resolve("tests/e2e/neoview"),
])
const ids = new Set<string>()

for (const feature of matrix.features) {
  if (ids.has(feature.id)) errors.push(`Duplicate feature id: ${feature.id}`)
  ids.add(feature.id)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.id)) errors.push(`Invalid feature id: ${feature.id}`)
  if (!feature.title.trim()) errors.push(`${feature.id}: missing title`)
  if (!feature.behaviorCases.length) errors.push(`${feature.id}: no behavior cases`)
  if (!feature.surfaces.length) errors.push(`${feature.id}: no surfaces`)
  if (!feature.legacySourcePatterns.length) errors.push(`${feature.id}: no source evidence`)
  for (const pattern of feature.legacySourcePatterns) {
    const regex = compile(pattern, `${feature.id} source`)
    if (regex && !sourceFiles.some((file) => regex.test(file))) {
      errors.push(`${feature.id}: source pattern matches no tracked file: ${pattern}`)
    }
  }
  for (const pattern of feature.legacyCommandPatterns) compile(pattern, `${feature.id} command`)
  if (feature.status !== "pending" && feature.status !== "removed-with-approval" && !feature.testIds.length) {
    errors.push(`${feature.id}: completed status requires testIds`)
  }
  for (const testId of feature.testIds) {
    if (!testCorpus.includes(`[${testId}]`)) errors.push(`${feature.id}: missing test id [${testId}]`)
  }
  if (feature.status === "removed-with-approval" && !feature.knownDifferences.length) {
    errors.push(`${feature.id}: removed feature requires an approved difference`)
  }
}

const unmatchedCommands = baseline.commands.filter((command) =>
  !matrix.features.some((feature) => feature.legacyCommandPatterns.some((pattern) => new RegExp(pattern).test(command.name))),
)
if (unmatchedCommands.length) {
  errors.push(`Unmapped commands (${unmatchedCommands.length}): ${unmatchedCommands.map((command) => command.name).join(", ")}`)
}

const functionalFiles = sourceFiles.filter(isFunctionalSource)
const unmatchedSources = functionalFiles.filter((file) =>
  !matrix.features.some((feature) => feature.legacySourcePatterns.some((pattern) => new RegExp(pattern).test(file))),
)
if (unmatchedSources.length) {
  errors.push(`Unmapped functional sources (${unmatchedSources.length}): ${unmatchedSources.join(", ")}`)
}

if (errors.length) throw new Error(`NeoView feature matrix validation failed:\n- ${errors.join("\n- ")}`)

const commandLinks = baseline.commands.reduce((count, command) => count + matrix.features.filter((feature) =>
  feature.legacyCommandPatterns.some((pattern) => new RegExp(pattern).test(command.name))).length, 0)
const checklist = renderChecklist(matrix, baseline, sourceFiles)
if (process.argv.includes("--update-doc")) {
  await writeFile(checklistPath, checklist, "utf8")
} else {
  const currentChecklist = await readFile(checklistPath, "utf8")
  if (currentChecklist !== checklist) throw new Error(`NeoView feature checklist drift: ${checklistPath}`)
}
process.stdout.write(
  `NeoView feature matrix valid: ${matrix.features.length} features, ${baseline.commands.length} commands, ${commandLinks} command links, ${functionalFiles.length} functional sources, revision ${head}.\n`,
)

function renderChecklist(matrix: Matrix, baseline: Baseline, sourceFiles: string[]): string {
  const statusCount = Object.fromEntries(matrix.statusValues.map((status) => [
    status,
    matrix.features.filter((feature) => feature.status === status).length,
  ]))
  const rows = matrix.features.map((feature, index) => {
    const commandCount = baseline.commands.filter((command) => feature.legacyCommandPatterns.some((pattern) => new RegExp(pattern).test(command.name))).length
    const sourceCount = sourceFiles.filter((file) => feature.legacySourcePatterns.some((pattern) => new RegExp(pattern).test(file))).length
    return `| ${index + 1} | \`${feature.id}\` | ${feature.title} | ${feature.status} | ${feature.surfaces.join("/")} | ${commandCount} | ${sourceCount} | ${feature.behaviorCases.join("<br>")} |`
  }).join("\n")
  const details = matrix.features.map((feature) => `### ${feature.title}（\`${feature.id}\`）\n\n` +
    `- 状态：\`${feature.status}\`\n` +
    `- 端：${feature.surfaces.join("、")}\n` +
    `- 设置：${feature.settingsKeys.length ? feature.settingsKeys.map((key) => `\`${key}\``).join("、") : "无"}\n` +
    `- 数据：${feature.dataStores.length ? feature.dataStores.join("、") : "无"}\n` +
    `- 行为：${feature.behaviorCases.join("；")}\n` +
    `- 测试：${feature.testIds.length ? feature.testIds.map((id) => `\`${id}\``).join("、") : "待补"}\n` +
    `- 性能基准：${feature.benchmarkIds.length ? feature.benchmarkIds.map((id) => `\`${id}\``).join("、") : "无专项"}\n` +
    `- 已知差异：${feature.knownDifferences.length ? feature.knownDifferences.join("；") : "无"}\n`).join("\n")
  return `# NeoView 最新功能迁移清单\n\n` +
    `> 由 \`migration/neoview/feature-compatibility.json\` 生成。功能证据只取冻结的最新源码 \`${matrix.sourceRevision}\`，不再逐提交追踪。不要手工编辑本文件。\n\n` +
    `## 覆盖摘要\n\n` +
    `- 功能：${matrix.features.length}\n` +
    `- 最新后端命令：${baseline.commands.length}，全部已映射\n` +
    `- 最新功能源码：${sourceFiles.filter(isFunctionalSource).length}，全部已映射\n` +
    `- 状态：${Object.entries(statusCount).map(([status, count]) => `${status}=${count}`).join("，")}\n` +
    `- 完成规则：没有行为测试 ID 的 feature 不得从 \`pending\` 改为完成状态；性能敏感项还必须具有可复现 benchmark。\n\n` +
    `## 推进表\n\n` +
    `| # | ID | 功能 | 状态 | 端 | 命令 | 源文件 | 必须保留的行为 |\n` +
    `| ---: | --- | --- | --- | --- | ---: | ---: | --- |\n${rows}\n\n` +
    `## 逐项验收\n\n${details}`
}

function isFunctionalSource(file: string): boolean {
  if (/(?:^|\/)(?:index|types)\.ts$|(?:^|\/)mod\.rs$|\.(?:test|spec)\.[^.]+$|\/rule\.md$/.test(file)) return false
  if (/^src\/lib\/(?:core\/utils\.ts|stores\/utils\/.*|utils\/(?:formatters|is-letter)\.ts)$/.test(file)) return false
  if (/^src\/lib\/components\/(ui|common)\//.test(file)) return false
  if (/^src\/lib\/(vendor|mocks|types)\//.test(file)) return false
  if (/^src-tauri\/src\/core\/(thumbnail_service_v3|thumbnail_service_v4|thumbnail_db|page_frame|upscale_service)\/tests?\//.test(file)) return false
  return /^(?:src\/(?:App|CardWindow|Settings)\.svelte|src\/lib\/(?:actions|api|cards|components\/(?:browser|cards|cardwindow|debug|dialogs|layout|panels|radial|viewer)|config|core|services|settings|stores|utils|workers)\/|src-tauri\/src\/(?:commands|core|models|tray|utils)\/)/.test(file)
}

function compile(pattern: string, label: string): RegExp | null {
  try { return new RegExp(pattern) } catch (error) {
    errors.push(`${label} invalid regex ${pattern}: ${String(error)}`)
    return null
  }
}

function git(args: string[]): string {
  const result = spawnSync("git", ["-C", source, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`)
  return result.stdout
}

async function readTestCorpus(roots: string[]): Promise<string> {
  const chunks: string[] = []
  for (const root of roots) await walk(root, chunks)
  return chunks.join("\n")
}

async function walk(path: string, chunks: string[]): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) await walk(child, chunks)
    else if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) chunks.push(await readFile(child, "utf8"))
  }
}
