/**
 * 门禁：危险执行的确认只许有一处实现。
 *
 * 背景：Hazard Mode 此前只强制关 dry-run，而 20 个节点的内联确认门条件写的都是
 * `!(data.dryRun ?? true)` —— 于是上膛 Hazard 会把确认框**点亮**而不是跳过，
 * 用户看到的「开了等于没开」其实是「开了更啰嗦」。现在确认统一由
 * `src/nodes/shared/ExecuteButton.tsx` 承担（引信 + hazard 短路），所以「节点自己
 * 写一个 AlertDialog 去包住 execute」这条模式必须封死：否则下一个节点又会长出第二份
 * 安全策略，hazard 再次只生效一半。
 *
 * 判据走 @ast-grep/napi（与 audit-node-ui-independence 同一把尺），不用行级正则：
 * JSX 的 onClick 常跨行，正则看不见跨行 clause。
 *
 * 尺自己也要被证伪：同一套求和跑在内置违规夹具上必须非零、跑在合规夹具上必须为零，
 * 否则「0 条」可能只是扫描器根本没工作。
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { parse, type SgNode } from "@ast-grep/napi"

/**
 * 出现在 AlertDialogAction 的 onClick 里就算违规：确认框又去自己发起执行了。
 * 用 \b 而不是排除前导点 —— 要抓的正是 `props.onExecute(...)` 这种成员调用。
 */
const EXECUTE_CALL = /\b(onExecute|execute|runAction|confirmRun)\s*\(/

const JSX_ELEMENT = { any: [{ kind: "jsx_opening_element" }, { kind: "jsx_self_closing_element" }] }

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full))
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(full)
  }
  return out
}

interface Finding {
  file: string
  line: number
  snippet: string
}

function tagName(node: SgNode): string {
  // 这套 grammar 里 jsx_opening_element 的 field("name") 是空的，标签名就是一个
  // 直接子节点（identifier / member_expression），所以按 kind 找而不是按 field 找。
  const nameNode = node.children().find((child) =>
    ["identifier", "member_expression", "jsx_namespace_name"].includes(child.kind()),
  )
  return nameNode?.text() ?? ""
}

function findDialogWrappedExecutes(fileName: string, source: string): Finding[] {
  let root: SgNode
  try {
    root = parse("tsx", source).root()
  } catch (error) {
    console.error(`FAIL danger-gate：解析 ${fileName} 失败 —— ${String(error)}`)
    process.exit(1)
  }

  const findings: Finding[] = []
  for (const node of root.findAll({ rule: JSX_ELEMENT })) {
    if (!tagName(node).endsWith("AlertDialogAction")) continue
    const children = node.children()
    for (const attr of children.filter((child) => child.kind() === "jsx_attribute")) {
      const attrChildren = attr.children()
      const attrName = attrChildren.find((child) => child.kind() === "property_identifier")
      if (!attrName || attrName.text() !== "onClick") continue
      // 处理器本体是 jsx_expression，跨行的箭头函数整块都在它的 text 里 ——
      // 这正是必须用 AST 而不是行正则的原因。
      const value = attrChildren.find((child) => child.kind() === "jsx_expression")
      if (!value || !EXECUTE_CALL.test(value.text())) continue
      findings.push({
        file: relative(process.cwd(), fileName),
        line: node.range().start.line + 1,
        snippet: value.text().replace(/\s+/g, " ").slice(0, 120),
      })
    }
  }
  return findings
}

function hasParseError(fileName: string, source: string): boolean {
  try {
    return parse("tsx", source).root().find({ rule: { kind: "ERROR" } }) !== null
  } catch {
    return true
  }
}

const VIOLATION_FIXTURE = `
const Violation = (props) => (
  <AlertDialogAction
    onClick={() => {
      props.onExecute(props.action)
    }}
  >
    确认执行
  </AlertDialogAction>
)
`

const COMPLIANT_FIXTURE = `
const Ok = (props) => (
  <>
    <AlertDialogAction onClick={() => workspaceActions.setHazardMode(false)}>关闭</AlertDialogAction>
    <ExecuteButton dangerous={props.live} onExecute={() => props.onExecute(props.action)} label="执行" />
  </>
)
`

function main() {
  // 正控用跨行写法：行级正则在这条上会漏，尺必须看得见它。
  const control = findDialogWrappedExecutes("fixture-violation.tsx", VIOLATION_FIXTURE)
  const negative = findDialogWrappedExecutes("fixture-compliant.tsx", COMPLIANT_FIXTURE)
  if (control.length === 0) {
    console.error("FAIL danger-gate 尺自检：跨行违规夹具命中 0 条 —— 扫描器是瞎的")
    process.exit(1)
  }
  if (negative.length !== 0) {
    console.error(`FAIL danger-gate 尺自检：合规夹具误报 ${negative.length} 条`)
    process.exit(1)
  }

  const files = collectSourceFiles(join(process.cwd(), "src/nodes"))
  const malformed: string[] = []
  const findings = files.flatMap((file) => {
    if (hasParseError(file, readFileSync(file, "utf8"))) malformed.push(relative(process.cwd(), file))
    return findDialogWrappedExecutes(file, readFileSync(file, "utf8"))
  })

  // 畸形文件会静默交出 0 条，所以「扫过」不等于「看得见」：单独报出来。
  if (malformed.length > 0) {
    for (const file of malformed) console.error(`  ${file} 解析出 ERROR 节点，本文件的判定不可信`)
    console.error(`FAIL danger-gate: ${malformed.length} 个文件解析失败`)
    process.exit(1)
  }

  console.log(`danger-gate: 扫了 ${files.length} 个节点源文件；尺自检 ${control.length} 命中 / ${negative.length} 误报`)

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line} 确认框自己发起执行 ⇒ ${finding.snippet}`)
    }
    console.error(`FAIL danger-gate: ${findings.length} 处危险确认绕过了 ExecuteButton`)
    process.exit(1)
  }
  console.log("OK danger-gate: 危险执行的确认只此一处（ExecuteButton）")
}

main()
