/**
 * 一次性改写脚本：让 MD3 组件层在「组件皮肤」拥有的 (slot, 属性) 上让位。
 *
 * 为什么用解析器而不是文本替换：皮肤块与 MD3 规则都有 `:has()` / `:where()` / 属性选择器，
 * 里面都有逗号。按逗号切选择器的正则会把选择器切碎，产出的 CSS 只有 Tailwind 解析器报错才发现
 * （我踩过：`Missing opening (`）。这里用 postcss 走 AST。
 *
 * 跑法：`bun scripts/md3-yield-to-skins.ts`（写盘）；加 `--dry` 只打印。
 * 归属表从 `src/index.css` 现读，不在这份文件里维护第二份名单。
 */
import { readFileSync, writeFileSync } from "node:fs"
import postcss from "postcss"

const SKIN_ATTRS = ["tabs-style", "switch-style", "slider-style", "scrollbar-style", "choice-control-style", "field-title-style"]
const SHORTHAND: Record<string, string[]> = {
  background: ["background-color", "background-image"],
  border: ["border-width", "border-color", "border-style"],
  "border-bottom": ["border-bottom-color", "border-bottom-width"],
  "border-top": ["border-top-color", "border-top-width"],
  "border-inline-start": ["border-inline-start-color", "border-inline-start-width"],
  "border-inline-end": ["border-inline-end-color", "border-inline-end-width"],
  "border-radius": ["border-start-start-radius", "border-start-end-radius", "border-end-start-radius", "border-end-end-radius"],
  padding: ["padding-inline", "padding-block", "padding-top", "padding-bottom", "padding-left", "padding-right"],
  margin: ["margin-top", "margin-bottom", "margin-inline", "margin-block"],
  inset: ["top", "right", "bottom", "left"],
  gap: ["row-gap", "column-gap"],
  font: ["font-family", "font-size", "font-weight", "line-height", "font-style"],
  flex: ["flex-grow", "flex-shrink", "flex-basis"],
}

function expand(prop: string): Set<string> {
  return new Set([prop, ...(SHORTHAND[prop] ?? [])])
}

function slotsIn(selector: string): string[] {
  return [...selector.matchAll(/\[data-slot="([a-z-]+)"\]/g)].map((m) => m[1] as string)
}

/** 逗号切分，只在括号/方括号深度 0 处切。 */
function splitSelectors(selector: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ""
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth += 1
    else if (ch === ")" || ch === "]") depth -= 1
    if (ch === "," && depth === 0) {
      out.push(current.trim())
      current = ""
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/** 皮肤拥有哪些 (slot, 属性)。真源是 index.css 的 [data-*-style] 块。 */
function skinOwned(): Map<string, Set<string>> {
  const indexCss = readFileSync("src/index.css", "utf8")
  const root = postcss.parse(indexCss)
  const owned = new Map<string, Set<string>>()
  root.walkRules((rule) => {
    if (!SKIN_ATTRS.some((attr) => rule.selector.includes(attr))) return
    const slots = slotsIn(rule.selector)
    if (slots.length === 0) return
    rule.walkDecls((decl) => {
      for (const prop of expand(decl.prop)) {
        for (const slot of slots) {
          const key = `${slot}::${prop}`
          if (!owned.has(key)) owned.set(key, new Set())
          owned.get(key)!.add(rule.selector.replace(/\s+/g, " ").slice(0, 60))
        }
      }
    })
  })
  return owned
}

const files = ["src/styles/design/md3-components.css", "src/styles/design/md3-components-selection.css"]
const owned = skinOwned()
const dry = process.argv.includes("--dry")
const report: string[] = []

for (const file of files) {
  const root = postcss.parse(readFileSync(file, "utf8"), { from: file })
  root.walkRules((rule) => {
    // 伪元素（状态层 ::after/::before）不是皮肤能表达的盒子，保留。
    if (rule.selector.includes("::after") || rule.selector.includes("::before")) return
    const decls = rule.nodes.filter((n): n is postcss.Declaration => n.type === "decl")
    const offendingSlots = new Set<string>()
    for (const decl of decls) {
      for (const slot of slotsIn(rule.selector)) {
        if (owned.has(`${slot}::${decl.prop}`)) offendingSlots.add(slot)
      }
    }
    if (offendingSlots.size === 0) return

    // 1) 把命中皮肤 slot 的选择器从这条规则的列表里摘掉
    const parts = splitSelectors(rule.selector)
    const kept = parts.filter((p) => !offendingSlots.has(slotsIn(p).join(",")))
    if (kept.length !== parts.length) {
      if (kept.length === 0) {
        rule.remove()
        report.push(`DELETE rule  ${file}  ${parts.join(" , ").slice(0, 90)}`)
        return
      }
      rule.selector = kept.join(",\n")
      report.push(`SHRINK rule  ${file}  去掉 ${[...offendingSlots].join(",")} → 剩 ${kept.length}/${parts.length}`)
    }
    // 2) 剩下的选择器里若仍有别的皮肤 slot 撞上具体属性，逐条删该声明
    const nowSlots = new Set(slotsIn(rule.selector))
    for (const decl of rule.nodes.filter((n): n is postcss.Declaration => n.type === "decl")) {
      for (const slot of nowSlots) {
        if (owned.has(`${slot}::${decl.prop}`)) {
          report.push(`DROP decl    ${file}  ${slot}::${decl.prop}`)
          decl.remove()
          break
        }
      }
    }
    if (rule.nodes.filter((n) => n.type === "decl").length === 0 && rule.selectors.length > 0) rule.remove()
  })
  if (!dry) writeFileSync(file, root.toString())
}

console.log(report.join("\n"))
console.log(`\n${dry ? "[dry] " : ""}owned pairs from index.css: ${owned.size}; changes: ${report.length}`)
