/**
 * 「组件皮肤 > 高级主题」这条优先级的静态门禁。
 *
 * 为什么要有静态门禁，光有运行时测试不够：MD3 层里长出一条 `tabs-trigger { border-radius }`
 * 时，只要皮肤那一档恰好给了同一个数，运行时断言就会绿着放过去；而换个皮肤档位它才炸。
 * 静态比对 (槽, 属性) 集合是**结构**判据，与数值无关。
 *
 * 两份名单都从文件现读：皮肤拥有的 (slot, 属性) 来自 `src/index.css` 的 `[data-*-style]` 块，
 * MD3 声明的来自 `src/styles/design/*.css`。归属表在 `scripts/md3-yield-to-skins.ts` 里也有一份
 * ——两处解析必须给同样的答案，所以这里连它的展开表一起测。
 */
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, test } from "vitest"

const SKIN_ATTRS = ["tabs-style", "switch-style", "slider-style", "scrollbar-style", "choice-control-style", "field-title-style"]

/** 简写属性 → 它实际会写到的长属性。皮肤用 `background`，MD3 用 `background-color`，同一个战场。 */
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

interface Rule {
  selector: string
  decls: string[]
}

/**
 * 手写而不是正则：CSS 规则里的 `{}` 会出现在 `@media` 嵌套与字符串里，
 * 声明值里也可能有 `;`。这里逐字符扫，跟踪字符串/括号深度。
 */
function parseRules(css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, " ")
  const rules: Rule[] = []
  let i = 0
  const n = clean.length
  while (i < n) {
    // 选择器：到下一个未闭合的 `{` 为止
    let depth = 0
    let inString: string | null = null
    let start = i
    while (i < n) {
      const ch = clean[i] as string
      if (inString) {
        if (ch === inString && clean[i - 1] !== "\\") inString = null
      } else if (ch === '"' || ch === "'") inString = ch
      else if (ch === "(" || ch === "[") depth += 1
      else if (ch === ")" || ch === "]") depth -= 1
      else if (ch === "{" && depth === 0) break
      i += 1
    }
    if (i >= n) break
    const selector = clean.slice(start, i).trim()
    const bodyStart = i + 1
    // 块体：找到配对的 `}`
    depth = 1
    inString = null
    let j = bodyStart
    let nestedAt = -1
    while (j < n) {
      const ch = clean[j] as string
      if (inString) {
        if (ch === inString && clean[j - 1] !== "\\") inString = null
      } else if (ch === '"' || ch === "'") inString = ch
      else if (ch === "(" || ch === "[") depth += 1
      else if (ch === ")" || ch === "]") depth -= 1
      else if (ch === "{") {
        if (depth === 1 && nestedAt < 0) nestedAt = j
        depth += 1
      } else if (ch === "}") {
        depth -= 1
        if (depth === 0) break
      }
      j += 1
    }
    const body = clean.slice(bodyStart, j)
    // 有嵌套块（@media 之类）时：外层不产声明，内层由后续循环当作规则处理——
    // 这里只取深度 1 的声明，避免把 @media 里的块当外层选择器的体。
    const decls = nestedAt < 0
      ? body.split(";").map((d) => d.split(":")[0]?.trim().toLowerCase() ?? "").filter((d) => d && !d.startsWith("@"))
      : []
    if (selector) rules.push({ selector, decls })
    i = nestedAt < 0 ? j + 1 : bodyStart
  }
  return rules
}

function slotsIn(selector: string): string[] {
  return [...selector.matchAll(/\[data-slot="([a-z-]+)"\]/g)].map((m) => m[1] as string)
}

function ownedBySkins(css: string): Set<string> {
  const out = new Set<string>()
  for (const rule of parseRules(css)) {
    if (!SKIN_ATTRS.some((attr) => rule.selector.includes(attr))) continue
    for (const slot of slotsIn(rule.selector)) {
      for (const prop of rule.decls) for (const expanded of [prop, ...(SHORTHAND[prop] ?? [])]) out.add(`${slot}::${expanded}`)
    }
  }
  return out
}

function md3Collisions(css: string, owned: Set<string>): string[] {
  const hits: string[] = []
  for (const rule of parseRules(css)) {
    if (rule.selector.includes("::after") || rule.selector.includes("::before")) continue
    const slots = new Set(slotsIn(rule.selector))
    for (const prop of rule.decls) {
      for (const slot of slots) if (owned.has(`${slot}::${prop}`)) hits.push(`${slot}::${prop}`)
    }
  }
  return [...new Set(hits)].sort()
}

const indexCss = readFileSync(path.resolve(import.meta.dirname, "../../index.css"), "utf8")
const designSheets = ["md3-components.css", "md3-components-selection.css"].map(
  (name) => [name, readFileSync(path.resolve(import.meta.dirname, name), "utf8")] as const,
)
const owned = ownedBySkins(indexCss)

describe("component skins outrank the md3 layer (static)", () => {
  test("the gauge reads a real ownership table from index.css", () => {
    expect(owned.size, "从 index.css 读出的 (slot,属性) 归属表是空的 ⇒ 这把尺瞎了").toBeGreaterThan(100)
    // 抽查几对确实被皮肤声明了，否则「不冲突」可能是因为没解析出来。
    for (const pair of ["tabs-trigger::border-radius", "toggle-group-item::background", "switch::background", "slider-thumb::height"]) {
      expect(owned.has(pair), `皮肤应当拥有 ${pair}`).toBe(true)
    }
  })

  test("the md3 layer declares nothing a skin owns", () => {
    for (const [name, css] of designSheets) {
      expect(md3Collisions(css, owned), `${name} 覆盖了组件皮肤拥有的属性`).toEqual([])
    }
  })

  test("the parser does not split selectors on commas inside :has() or attribute lists", () => {
    // 这是本轮真实踩过的坑：按逗号切选择器把 `:has([a],[b])` 切碎，产出坏 CSS，
    // 只有 Tailwind 解析器报 `Missing opening (` 才发现。这里把它钉成反例。
    const rules = parseRules('.a:has([data-slot="x"], [data-slot="y"]) > .b[data-tabs-style="pill"] { border-radius: 4px }')
    expect(rules).toHaveLength(1)
    expect(slotsIn(rules[0]!.selector)).toEqual(["x", "y"])
    expect(rules[0]!.decls).toContain("border-radius")
  })

  test("a collision is actually caught (falsification control)", () => {
    const planted = ':root[data-app-design="md3"] [data-slot="tabs-trigger"] { border-radius: 28px }'
    expect(md3Collisions(planted, owned)).toContain("tabs-trigger::border-radius")
    // 反向对照：伪元素上的状态层不是皮肤能表达的盒子，不该被算成冲突。
    expect(md3Collisions(':root[data-app-design="md3"] [data-slot="tabs-trigger"]::after { background-color: red }', owned)).toEqual([])
  })
})
