/**
 * 改写脚本：让 MD3 组件层在「组件皮肤」拥有的 (slot, 属性)上让位——**加门，不删声明**。
 *
 * 为什么不许再退回「删声明」：删掉之后，皮肤**没在场**时也没人管那个控件了。
 * 2026-10-05 第一版就是删声明，实测分段控件（`toggle-group-item`）在 native / md3 / mondrian
 * 三份配方下 border-radius 一模一样（有皮肤 0px、无皮肤 `4px 0 0 4px`），等于「高级主题
 * 根本不接管这个控件」。用户的裁定是「组件皮肤 > 高级主题」，不是「皮肤在不在都让位」。
 * 现在这条规则由 `src/styles/design/skinPriority.test.ts` 钉住：皮肤拥有的 (slot,属性)
 * 上的声明，选择器必须排除掉拥有它的那个皮肤属性。
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

/** 从选择器里取出皮肤属性名（`data-choice-control-style` → `choice-control-style`）。 */
function skinAttrsIn(selector: string): string[] {
  return [...selector.matchAll(/data-([a-z-]+)-style/g)].map((m) => `data-${m[1] as string}-style`)
}

/**
 * 皮肤拥有哪些 (slot, 属性)，以及**是哪一个皮肤属性**拥有它。
 * 真源是 index.css 的 [data-*-style] 块；值里的属性名用来生成 `:not([data-…-style])` 那道门。
 */
function skinOwned(): Map<string, Set<string>> {
  const indexCss = readFileSync("src/index.css", "utf8")
  const root = postcss.parse(indexCss)
  const owned = new Map<string, Set<string>>()
  root.walkRules((rule) => {
    if (!SKIN_ATTRS.some((attr) => rule.selector.includes(attr))) return
    const slots = slotsIn(rule.selector)
    if (slots.length === 0) return
    const attrs = skinAttrsIn(rule.selector)
    if (attrs.length === 0) return
    rule.walkDecls((decl) => {
      for (const prop of expand(decl.prop)) {
        for (const slot of slots) {
          const key = `${slot}::${prop}`
          if (!owned.has(key)) owned.set(key, new Set())
          for (const attr of attrs) owned.get(key)!.add(attr)
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
    // 这条规则需要排除哪些皮肤属性：按 (选择器部分, 声明) 逐个查归属。
    const needed = new Set<string>()
    for (const decl of decls) {
      for (const slot of slotsIn(rule.selector)) {
        for (const attr of owned.get(`${slot}::${decl.prop}`) ?? []) needed.add(attr)
      }
    }
    if (needed.size === 0) return
    const parts = splitSelectors(rule.selector)
    let changed = false
    const gated = parts.map((part) => {
      const missing = [...needed].filter((attr) => !part.includes(`:not([${attr}])`))
      if (missing.length === 0) return part
      changed = true
      const clause = missing.map((attr) => `:not([${attr}])`).join("")
      // 挂在 `:root[...]` 上：皮肤属性就写在 `:root` 上，同一元素上的 `:not()` 才是对的判据。
      const at = part.indexOf(":root")
      if (at < 0) return `:root${clause} ${part}`
      const end = part.indexOf("]", at)
      if (end < 0) return `:root${clause} ${part}`
      // 找到 `:root` 后面紧跟的那一段属性/伪类，把 :not() 接在它之后。
      let i = end + 1
      while (i < part.length && (part[i] === "[" || part[i] === ":")) {
        const next = part.indexOf("]", i)
        if (next < 0) break
        i = next + 1
      }
      return `${part.slice(0, i)}${clause}${part.slice(i)}`
    })
    if (changed) {
      rule.selector = gated.join(",\n")
      report.push(`GATE  ${file}  加 ${[...needed].sort().join(",")} → ${gated[0].slice(0, 90)}`)
    }
  })
  if (!dry) writeFileSync(file, root.toString())
}

console.log(report.join("\n"))
console.log(`\n${dry ? "[dry] " : ""}owned pairs from index.css: ${owned.size}; gated rules: ${report.length}`)
