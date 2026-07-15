import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

type Status = "pending" | "partial" | "complete" | "migrated" | "replaced"

interface FolderItem {
  id: string
  category: string
  title: string
  sourceEvidence: string[]
  targetContract: string
  status: Status
  testIds: string[]
  notes: string
}

interface CardEntry {
  legacyId: string
  title: string
  panelId: string
  priority: string
  featureId: string
  status: Status
  currentCardId?: string
  sourceComponent?: string
  sourceDisposition: "component" | "registry-only"
  sourceNotes?: string
}

const root = resolve(import.meta.dir, "..")
const folder = await readJson<{ items: FolderItem[] }>(resolve(root, "migration/neoview/folder-main-compatibility.json"))
const cards = await readJson<{ cards: CardEntry[] }>(resolve(root, "migration/neoview/card-compatibility.json"))
const features = await readJson<{ features: Array<{ id: string; title: string }> }>(resolve(root, "migration/neoview/feature-compatibility.json"))
const featureTitles = new Map(features.features.map((feature) => [feature.id, feature.title]))
const lines: string[] = [
  "# NeoView Card 完整功能与 UI 验收清单",
  "",
  "> 本文件由 `bun run generate:neoview-card-checklist` 生成。机器事实源为 `migration/neoview/folder-main-compatibility.json` 与 `migration/neoview/card-compatibility.json`，请勿只改本文件。",
  "",
  "## 完成规则",
  "",
  "- 所有 Card 都执行“先冻结源码清单，再实现，再验收”；只有标题或后端 API 不算完成。",
  "- `complete/migrated` 必须覆盖功能、UI 层级、控件与图标、交互状态、持久化、键盘/无障碍、共享 GUI/CLI/TUI 契约、生命周期、性能、测试和有意偏离。",
  "- UI 默认保持旧版信息层级、密度和操作位置；只允许使用 XR 设计 token 和既有通用组件做等价适配。桌面侧栏、窄侧栏和独立 Card 窗口都要有截图或几何证据。",
  "- `pending/partial` 是真实状态，不得为了提高数字提前改成完成；旧版自身缺失的能力必须标为 `registry-only` 或记录替代决策。",
  "- Windows 重验证严格串行，Vitest 固定 `--maxWorkers=1`，防止清单验证本身触发内存耗尽。",
  "",
  "## 文件浏览器 `folderMain`",
  "",
  `共 ${folder.items.length} 项：${statusSummary(folder.items)}。以下是完整验收项，不是自然排序或单列表的缩减版。`,
  "",
]

for (const [category, items] of groupBy(folder.items, (item) => item.category)) {
  lines.push(`### ${category}（${items.length}）`, "")
  for (const item of items) {
    lines.push(
      `- ${statusMark(item.status)} \`${item.id}\` ${item.title}`,
      `  - 目标：${item.targetContract}`,
      `  - 源码：${item.sourceEvidence.map((source) => `\`${source}\``).join("、")}`,
      `  - 测试：${item.testIds.length ? item.testIds.map((id) => `\`${id}\``).join("、") : "待补"}`,
      `  - 备注：${item.notes || "无"}`,
    )
  }
  lines.push("")
}

lines.push(
  "## 全部 77 张 Card",
  "",
  "下表是逐卡迁移索引。`功能域` 只是第一层归属；每张 Card 开工时仍必须像 `folderMain` 一样把源码内全部命令、字段、模式和状态展开为专用明细，审计通过后才能实现。",
  "",
)

for (const [panelId, panelCards] of groupBy(cards.cards, (card) => card.panelId)) {
  lines.push(`### Panel: \`${panelId}\`（${panelCards.length}）`, "")
  lines.push("| Card | 功能 | 优先级 | 状态 | 旧版源组件 | 功能域 / 当前映射 |", "|---|---|---:|---:|---|---|")
  for (const card of panelCards) {
    const source = card.sourceComponent ? `\`${card.sourceComponent}\`` : `**registry-only**：${card.sourceNotes ?? "无组件映射"}`
    const current = card.currentCardId ? `；XR \`${card.currentCardId}\`` : ""
    lines.push(`| \`${card.legacyId}\` | ${escapeTable(card.title)} | ${card.priority} | ${card.status} | ${escapeTable(source)} | ${escapeTable(featureTitles.get(card.featureId) ?? card.featureId)}${current} |`)
  }
  lines.push("")
}

lines.push(
  "## 每张 Card 的专用清单模板",
  "",
  "每张 Card 的专用 JSON 至少包含以下 10 类，不能以这份模板本身代替源码逐项清单：",
  "",
  "1. `capabilities`：全部命令、模式、数据字段、批量动作和跨模块联动。",
  "2. `ui-parity`：层级、控件、图标、文字、密度、尺寸和响应式几何。",
  "3. `interaction-states`：默认、hover、focus、selected、disabled、loading、empty、partial、error、retry、disposed。",
  "4. `settings`：默认值、旧键、优先级、TOML 目标字段、重置和导入。",
  "5. `keyboard-accessibility`：快捷键、焦点顺序、语义角色、IME 排除和可访问名称。",
  "6. `data-contract`：DTO、稳定身份、分页/流、取消、generation、错误和过期结果。",
  "7. `lifecycle`：lazy load、open、suspend、resume、close、dispose 和失败清理。",
  "8. `performance`：代表性语料、延迟、内存、DOM、任务和缓存预算。",
  "9. `tests`：稳定测试 ID、交互、截图/几何和性能回归。",
  "10. `deviations`：删减、替换或有意改变的旧行为及理由。",
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

function statusSummary(values: Array<{ status: Status }>): string {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value.status, (counts.get(value.status) ?? 0) + 1)
  return [...counts].map(([status, count]) => `\`${status}=${count}\``).join("，")
}

function statusMark(status: Status): string {
  return status === "complete" || status === "migrated" || status === "replaced" ? "[x]" : "[ ]"
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}
