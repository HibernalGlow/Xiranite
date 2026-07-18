import { spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  CAPABILITY_DIMENSIONS,
  blockedDimensions,
  buildTestEvidenceIndex,
  compactCapabilityStatus,
  deriveOverallStatus,
  overallCounts,
  parseFeatureMatrix,
  statusCounts,
  type CapabilityDimension,
  type FeatureEntry,
  type FeatureMatrix,
} from "./lib/neoview-capability-status"

interface Baseline {
  sourceRevision: { commit: string | null }
  commands: Array<{ name: string; location: { file: string; line: number } }>
}

const matrixPath = resolve("migration/neoview/feature-compatibility.json")
const baselinePath = resolve("migration/neoview/inventory-baseline.json")
const checklistPath = resolve("docs/neoview-feature-checklist.md")
const matrix = await parseFeatureMatrix(matrixPath)
const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as Baseline
const source = resolve(process.env.NEOVIEW_SOURCE ?? "../ImageAll/NeeWaifu/neoview/neoview-tauri")
const root = resolve(".")

const errors: string[] = []
if (matrix.sourceRevision !== baseline.sourceRevision.commit) {
  errors.push(`Matrix revision ${matrix.sourceRevision} differs from inventory ${baseline.sourceRevision.commit}`)
}

const head = git(["rev-parse", "HEAD"]).trim()
if (head !== matrix.sourceRevision) errors.push(`NeoView HEAD ${head} differs from matrix ${matrix.sourceRevision}`)
const sourceFiles = git(["ls-files"]).split(/\r?\n/).filter(Boolean)
const evidence = await buildTestEvidenceIndex(root)
const ids = new Set<string>()

for (const feature of matrix.features) {
  if (ids.has(feature.id)) errors.push(`Duplicate feature id: ${feature.id}`)
  ids.add(feature.id)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.id)) errors.push(`Invalid feature id: ${feature.id}`)
  if (!feature.behaviorCases.length) errors.push(`${feature.id}: no behavior cases`)
  if (!feature.surfaces.length) errors.push(`${feature.id}: no surfaces`)
  if (!feature.legacySourcePatterns.length) errors.push(`${feature.id}: no source evidence`)
  validateSurfaceApplicability(feature)
  for (const pattern of feature.legacySourcePatterns) {
    const regex = compile(pattern, `${feature.id} source`)
    if (regex && !sourceFiles.some((file) => regex.test(file))) {
      errors.push(`${feature.id}: source pattern matches no tracked file: ${pattern}`)
    }
  }
  for (const pattern of feature.legacyCommandPatterns) compile(pattern, `${feature.id} command`)
  for (const testId of feature.testIds) {
    if (!evidence.has(testId)) errors.push(`${feature.id}: missing tracked test id [${testId}]`)
  }
  if (feature.plannedTestIds.length && feature.capabilityStatus.evidence === "complete") {
    errors.push(`${feature.id}: evidence is complete while planned tests remain: ${feature.plannedTestIds.join(", ")}`)
  }
  validateCompletedEvidence(feature)
  if (feature.disposition === "removed-with-approval" && !feature.knownDifferences.length) {
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

if (process.argv.includes("--require-complete")) {
  for (const feature of matrix.features) {
    const status = deriveOverallStatus(feature.capabilityStatus)
    if (status !== "complete") errors.push(`${feature.id}: remains ${status} (${blockedDimensions(feature.capabilityStatus).join(", ")})`)
  }
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

function validateSurfaceApplicability(feature: FeatureEntry): void {
  for (const surface of feature.surfaces) {
    const dimension = surface as "gui" | "cli" | "tui"
    if (feature.capabilityStatus[dimension] === "not-applicable") errors.push(`${feature.id}: ${dimension} is required by surfaces but marked not-applicable`)
  }
}

function validateCompletedEvidence(feature: FeatureEntry): void {
  const covered = evidence.dimensions(feature.testIds)
  for (const dimension of CAPABILITY_DIMENSIONS) {
    if (feature.capabilityStatus[dimension] !== "complete") continue
    if (dimension === "evidence") {
      if (!feature.testIds.length) errors.push(`${feature.id}: evidence is complete without test IDs`)
      continue
    }
    if (!covered.has(dimension)) errors.push(`${feature.id}: ${dimension} is complete without dimension-specific tracked test evidence`)
  }
}

function renderChecklist(value: FeatureMatrix, baselineValue: Baseline, sourceFilesValue: string[]): string {
  const dimensionCounts = statusCounts(value.features.map((feature) => feature.capabilityStatus))
  const overall = overallCounts(value.features.map((feature) => feature.capabilityStatus))
  const rows = value.features.map((feature, index) => {
    const commandCount = baselineValue.commands.filter((command) => feature.legacyCommandPatterns.some((pattern) => new RegExp(pattern).test(command.name))).length
    const sourceCount = sourceFilesValue.filter((file) => feature.legacySourcePatterns.some((pattern) => new RegExp(pattern).test(file))).length
    const blockers = blockedDimensions(feature.capabilityStatus)
    return `| ${index + 1} | \`${feature.id}\` | ${feature.title} | ${deriveOverallStatus(feature.capabilityStatus)} | ${feature.disposition} | \`${compactCapabilityStatus(feature.capabilityStatus)}\` | ${blockers.length ? blockers.join(", ") : "无"} | ${feature.surfaces.join("/")} | ${commandCount} | ${sourceCount} | ${feature.behaviorCases.join("<br>")} |`
  }).join("\n")
  const details = value.features.map((feature) => `### ${feature.title}（\`${feature.id}\`）\n\n` +
    `- 派生总体：\`${deriveOverallStatus(feature.capabilityStatus)}\`\n` +
    `- 处置：\`${feature.disposition}\`\n` +
    `- 六维：\`${compactCapabilityStatus(feature.capabilityStatus)}\`\n` +
    `- 阻塞维度：${blockedDimensions(feature.capabilityStatus).length ? blockedDimensions(feature.capabilityStatus).map((dimension) => `\`${dimension}\``).join("、") : "无"}\n` +
    `- 端：${feature.surfaces.join("、")}\n` +
    `- 设置：${feature.settingsKeys.length ? feature.settingsKeys.map((key) => `\`${key}\``).join("、") : "无"}\n` +
    `- 数据：${feature.dataStores.length ? feature.dataStores.join("、") : "无"}\n` +
    `- 行为：${feature.behaviorCases.join("；")}\n` +
    `- 测试：${feature.testIds.length ? feature.testIds.map((id) => `\`${id}\``).join("、") : "待补"}\n` +
    `- 计划测试：${feature.plannedTestIds.length ? feature.plannedTestIds.map((id) => `\`${id}\``).join("、") : "无"}\n` +
    `- 性能基准：${feature.benchmarkIds.length ? feature.benchmarkIds.map((id) => `\`${id}\``).join("、") : "无专项"}\n` +
    `- 已知差异：${feature.knownDifferences.length ? feature.knownDifferences.join("；") : "无"}\n`).join("\n")
  return `# NeoView 最新功能迁移清单\n\n` +
    `> 由 \`migration/neoview/feature-compatibility.json\` 生成。功能证据只取冻结的最新源码 \`${value.sourceRevision}\`，不再逐提交追踪。不要手工编辑本文件。\n\n` +
    `## 六维图例\n\n` +
    `固定顺序为 \`core / transport / gui / cli / tui / evidence\`；\`C\`=complete，\`P\`=partial，\`-\`=pending，\`N/A\`=not-applicable。总体状态仅由六维派生，不在 JSON 中重复保存。\n\n` +
    `## 覆盖摘要\n\n` +
    `- 功能：${value.features.length}\n` +
    `- 最新后端命令：${baselineValue.commands.length}，全部已映射\n` +
    `- 最新功能源码：${sourceFilesValue.filter(isFunctionalSource).length}，全部已映射\n` +
    `- 派生总体：${Object.entries(overall).map(([status, count]) => `${status}=${count}`).join("，")}\n` +
    `${CAPABILITY_DIMENSIONS.map((dimension) => `- ${dimension}：${formatDimensionCounts(dimensionCounts[dimension])}`).join("\n")}\n` +
    `- 完成规则：每个必需维度必须独立完成并具有该维度的 tracked test evidence；单一 core/HTTP/GUI 路径不能提升整个 feature。\n\n` +
    `## 推进表\n\n` +
    `| # | ID | 功能 | 总体 | 处置 | 六维 | 阻塞 | 端 | 命令 | 源文件 | 必须保留的行为 |\n` +
    `| ---: | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- |\n${rows}\n\n` +
    `## 逐项验收\n\n${details}`
}

function formatDimensionCounts(value: Record<string, number>): string {
  return ["complete", "partial", "pending", "not-applicable"].map((status) => `${status}=${value[status] ?? 0}`).join("，")
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
