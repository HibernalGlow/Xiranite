import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  blockedDimensions,
  compactCapabilityStatus,
  deriveOverallStatus,
  overallCounts,
  parseCardMatrix,
  parseDetailedChecklist,
  type DetailedChecklist,
} from "./lib/neoview-capability-status"

interface CardFunctionalScope {
  legacyId: string
  capabilities: string[]
  checklistRef?: string
}

const root = resolve(import.meta.dir, "..")
const cards = await parseCardMatrix(resolve(root, "migration/neoview/card-compatibility.json"))
const scopes = await readJson<{ cards: CardFunctionalScope[] }>(resolve(root, "migration/neoview/card-functional-scopes.json"))
const detailedChecklists = new Map<string, DetailedChecklist>()
for (const scope of scopes.cards) {
  if (!scope.checklistRef) continue
  detailedChecklists.set(scope.checklistRef, await parseDetailedChecklist(resolve(root, scope.checklistRef)))
}
const folder = [...detailedChecklists.values()].find((checklist) => checklist.legacyCardId === "folderMain")
if (!folder) throw new Error("folderMain detailed checklist is missing")
const features = await readJson<{ features: Array<{ id: string; title: string }> }>(resolve(root, "migration/neoview/feature-compatibility.json"))
const featureTitles = new Map(features.features.map((feature) => [feature.id, feature.title]))
const scopeByCard = new Map(scopes.cards.map((scope) => [scope.legacyId, scope]))
const lines: string[] = [
  "# NeoView Card 完整功能与 UI 验收清单",
  "",
  `> 本文件由 \`bun run generate:neoview-card-checklist\` 生成。机器事实源为 ${[...detailedChecklists.keys(), "migration/neoview/card-functional-scopes.json", "migration/neoview/card-compatibility.json"].map((path) => `\`${path}\``).join("、")}，请勿只改本文件。`,
  "",
  "## 完成规则",
  "",
  "- 所有 Card 都执行“先冻结源码清单，再实现，再验收”；只有标题或后端 API 不算完成。",
  "- 派生 `complete` 必须覆盖所有适用维度：功能核心、传输、GUI/CLI/TUI 接线和证据；任一必需维度未闭环时总体只能是 partial/pending。",
  "- UI 默认保持旧版信息层级、密度和操作位置；只允许使用 XR 设计 token 和既有通用组件做等价适配。桌面侧栏、窄侧栏和独立 Card 窗口都要有截图或几何证据。",
  "- 六维中的 `pending/partial` 是真实状态，不得为了提高数字提前改成 complete；旧版自身缺失的能力必须标为 `registry-only` 或记录替代决策。",
  "- Windows 重验证严格串行，Vitest 固定 `--maxWorkers=1`，防止清单验证本身触发内存耗尽。",
  "",
  "## 六维图例",
  "",
  "固定顺序为 `core / transport / gui / cli / tui / evidence`；`C`=complete，`P`=partial，`-`=pending，`N/A`=not-applicable。总体状态仅由六维派生，不在 JSON 中重复保存。",
  "",
  "## 文件浏览器 `folderMain`",
  "",
  `共 ${folder.items.length} 项：${overallSummary(folder.items)}。以下是完整验收项，不是自然排序或单列表的缩减版。`,
  "",
  `### 旧版源码 UI/控件库存（${folder.sourceUiInventory.length} 组，${folder.sourceUiInventory.reduce((total, group) => total + group.acceptanceItems.length, 0)} 项）`,
  "",
  "这里逐项冻结原版可见控件、选项值、字段和状态。实现不能只满足下方 74 个能力域；本库存中的每一项也必须保留，或记录明确的替代/偏离决策。",
  "",
]

for (const group of folder.sourceUiInventory) {
  lines.push(
    `#### \`${group.id}\` ${group.title}`,
    "",
    `- 源码：${group.sourceEvidence.map((source) => `\`${source}\``).join("、")}`,
    `- 映射：${group.mappedChecklistIds.map((id) => `\`${id}\``).join("、")}`,
    ...group.acceptanceItems.map((item) => `- [ ] ${item}`),
    "",
  )
}

lines.push("### 源码级验收项", "")

for (const [category, items] of groupBy(folder.items, (item) => item.category)) {
  lines.push(`### ${category}（${items.length}）`, "")
  for (const item of items) {
    lines.push(
      `- ${statusMark(item.capabilityStatus)} \`${item.id}\` ${item.title}`,
      `  - 六维：\`${compactCapabilityStatus(item.capabilityStatus)}\`；阻塞：${blockers(item.capabilityStatus)}`,
      `  - 目标：${item.targetContract}`,
      `  - 源码：${item.sourceEvidence.map((source) => `\`${source}\``).join("、")}`,
      `  - 测试：${item.testIds.length ? item.testIds.map((id) => `\`${id}\``).join("、") : "待补"}`,
      `  - 计划测试：${item.plannedTestIds.length ? item.plannedTestIds.map((id) => `\`${id}\``).join("、") : "无"}`,
      `  - 备注：${item.notes || "无"}`,
    )
  }
  lines.push("")
}

lines.push(
  "## 全部 77 张 Card",
  "",
  "下面 77/77 张 Card 均已冻结最低功能范围。功能范围防止整张 Card 或主要能力被漏掉，但不等于完成证据；每张 Card 开工时仍必须把源码内命令、字段、模式、状态和 UI 几何展开为专用验收项。",
  "",
)

for (const [panelId, panelCards] of groupBy(cards.cards, (card) => card.panelId)) {
  lines.push(`### Panel: \`${panelId}\`（${panelCards.length}）`, "")
  lines.push("| Card | 功能 | 优先级 | 总体 | 六维 | 旧版源组件 | 功能域 / 当前映射 |", "|---|---|---:|---:|---|---|---|")
  for (const card of panelCards) {
    const source = card.sourceComponent ? `\`${card.sourceComponent}\`` : `**registry-only**：${card.sourceNotes ?? "无组件映射"}`
    const current = card.currentCardId ? `；XR \`${card.currentCardId}\`` : ""
    lines.push(`| \`${card.legacyId}\` | ${escapeTable(card.title)} | ${card.priority} | ${deriveOverallStatus(card.capabilityStatus)} | \`${compactCapabilityStatus(card.capabilityStatus)}\` | ${escapeTable(source)} | ${escapeTable(featureTitles.get(card.featureId) ?? card.featureId)}${current} |`)
  }
  lines.push("")
  for (const card of panelCards) {
    const scope = scopeByCard.get(card.legacyId)
    lines.push(`#### \`${card.legacyId}\` ${card.title}`, "")
    if (scope?.checklistRef) lines.push(`- 细项清单：\`${scope.checklistRef}\``)
    const capabilityMark = deriveOverallStatus(card.capabilityStatus) === "complete" ? "[x]" : "[ ]"
    for (const capability of scope?.capabilities ?? []) lines.push(`- ${capabilityMark} ${capability}`)
    lines.push(`- UI 基线：\`${card.sourceComponent ?? "registry-only"}\`；保持旧层级、控件、图标语义、密度和交互状态，偏离必须单独记录。`, "")
    const detailed = scope?.checklistRef ? detailedChecklists.get(scope.checklistRef) : undefined
    if (detailed && detailed.legacyCardId !== "folderMain") appendDetailedChecklist(lines, detailed)
  }
}

lines.push(
  "## 每张 Card 的专用清单模板",
  "",
  "每张 Card 的专用 JSON 至少包含以下 10 类，不能以这份模板本身代替源码逐项清单：",
  "",
  "1. `source-ui-inventory`：逐个控件、菜单项、选项值、字段、快捷键和状态，含源码证据及验收项映射。",
  "2. `capabilities`：全部命令、模式、数据字段、批量动作和跨模块联动。",
  "3. `ui-parity`：层级、控件、图标、文字、密度、尺寸和响应式几何。",
  "4. `interaction-states`：默认、hover、focus、selected、disabled、loading、empty、partial、error、retry、disposed。",
  "5. `settings`：默认值、旧键、优先级、TOML 目标字段、重置和导入。",
  "6. `keyboard-accessibility`：快捷键、焦点顺序、语义角色、IME 排除和可访问名称。",
  "7. `data-contract`：DTO、稳定身份、分页/流、取消、generation、错误和过期结果。",
  "8. `lifecycle`：lazy load、open、suspend、resume、close、dispose 和失败清理。",
  "9. `performance`：代表性语料、延迟、内存、DOM、任务和缓存预算。",
  "10. `tests`：稳定测试 ID、交互、截图/几何和性能回归。",
  "11. `deviations`：删减、替换或有意改变的旧行为及理由。",
)

const outputPath = resolve(root, "docs/neoview-card-functional-checklist.md")
const output = `${lines.join("\n")}\n`
if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "")
  if (current !== output) {
    console.error("docs/neoview-card-functional-checklist.md is stale; run bun run generate:neoview-card-checklist")
    process.exit(1)
  }
} else {
  await writeFile(outputPath, output, "utf8")
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

function groupBy<T>(values: T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const value of values) {
    const key = keyOf(value)
    groups.set(key, [...(groups.get(key) ?? []), value])
  }
  return groups
}

function overallSummary(values: Array<{ capabilityStatus: DetailedChecklist["items"][number]["capabilityStatus"] }>): string {
  const counts = overallCounts(values.map((value) => value.capabilityStatus))
  return Object.entries(counts).map(([status, count]) => `\`${status}=${count}\``).join("，")
}

function statusMark(status: DetailedChecklist["items"][number]["capabilityStatus"]): string {
  return deriveOverallStatus(status) === "complete" ? "[x]" : "[ ]"
}

function blockers(status: DetailedChecklist["items"][number]["capabilityStatus"]): string {
  const values = blockedDimensions(status)
  return values.length ? values.map((dimension) => `\`${dimension}\``).join("、") : "无"
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}

function appendDetailedChecklist(lines: string[], checklist: DetailedChecklist): void {
  lines.push(
    `##### 专用逐控件库存（${checklist.sourceUiInventory.length} 组，${checklist.sourceUiInventory.reduce((total, group) => total + group.acceptanceItems.length, 0)} 项）`,
    "",
  )
  for (const group of checklist.sourceUiInventory) {
    lines.push(
      `- \`${group.id}\` ${group.title}`,
      `  - 源码：${group.sourceEvidence.map((source) => `\`${source}\``).join("、")}`,
      `  - 映射：${group.mappedChecklistIds.map((id) => `\`${id}\``).join("、")}`,
      ...group.acceptanceItems.map((item) => `  - [ ] ${item}`),
    )
  }
  lines.push("", "##### 专用源码级验收项", "")
  for (const item of checklist.items) {
    lines.push(
      `- ${statusMark(item.capabilityStatus)} \`${item.id}\` ${item.title}`,
      `  - 六维：\`${compactCapabilityStatus(item.capabilityStatus)}\`；阻塞：${blockers(item.capabilityStatus)}`,
      `  - 目标：${item.targetContract}`,
      `  - 源码：${item.sourceEvidence.map((source) => `\`${source}\``).join("、")}`,
      `  - 测试：${item.testIds.length ? item.testIds.map((id) => `\`${id}\``).join("、") : "待补"}`,
      `  - 计划测试：${item.plannedTestIds.length ? item.plannedTestIds.map((id) => `\`${id}\``).join("、") : "无"}`,
      `  - 备注：${item.notes || "无"}`,
    )
  }
  lines.push("")
}
