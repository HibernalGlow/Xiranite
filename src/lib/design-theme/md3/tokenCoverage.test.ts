/**
 * 高级主题的变量覆盖门禁（双向）。
 *
 * 它要挡的是两类完全不同的坏：
 *  1. **CSS 层引用了引擎没发的变量** —— 画面上那块直接坏掉，而构建照样绿；
 *  2. **引擎发了一堆没人消费的变量** —— 「看起来接了 Material 规范」其实是死数据。
 *     字典里有 3160 条组件 token，全发就是往 `:root` 挂三千多个 inline 变量，
 *     所以这一方向不是洁癖，是性能与诚实度。
 *
 * 两个方向都只认真生产者：emit 集合来自 `resolveDesignTheme`（不是手抄名单），
 * 引用集合从 `src/styles/design/*.css` 现读。尺本身再用注入的假引用做证伪——
 * 看不见违规的尺等于没有尺。
 *
 * 本文件覆盖**所有**已注册配方，不只是 MD3：下面第二个 describe 是风格派（`--stijl-*`），
 * 它对「无人引用即红」的范围和 MD3 不同，理由写在那段注释里。
 * 位置留在 `md3/` 只是历史原因——它是先有 MD3 时建的，`package.json` 的
 * `audit:design-theme-tokens` 指的就是这个路径。
 */
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import { describe, expect, test } from "vitest"

import { ALL_DIMENSIONS_ON, BRIDGED_COLOR_VARS, DEFAULT_DESIGN_THEME, MD3_VAR, type DesignThemeConfig } from "../contract"
import { resolveDesignTheme } from "../registry"
import { STIJL_COLOR_VARS, STIJL_GEOMETRY_VARS, STIJL_VAR } from "../mondrian/resolve"

const DESIGN_STYLE_DIR = path.resolve(import.meta.dirname, "../../../styles/design")
/** 引擎词表里由本门禁双向核对的命名空间（sys/ref 是完整词汇表，不参与「无人引用即红」）。 */
const COMPONENT_PREFIX = MD3_VAR.component

function designCssFiles(): string[] {
  try {
    return readdirSync(DESIGN_STYLE_DIR)
      .filter((name) => name.endsWith(".css"))
      .map((name) => path.join(DESIGN_STYLE_DIR, name))
  } catch {
    return []
  }
}

/**
 * `var( --x , fallback )` 可能跨行，所以先把空白折叠成单个空格再匹配。
 * 行级正则是这类检查的已知瞎眼来源，这里不留那个洞。
 */
function parseCss(css: string): { refs: Set<string>; declared: Set<string>; fallbacks: Set<string>; body: string } {
  const collapsed = css.replace(/\s+[\s,]*"/g, ' "').replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ")
  const refs = new Set<string>()
  const fallbacks = new Set<string>()
  for (const match of collapsed.matchAll(/var\(\s*(--[A-Za-z0-9-]+)\s*(,)?/g)) {
    refs.add(match[1] as string)
    if (match[2]) fallbacks.add(match[1] as string)
  }
  // 声明形式是 `--x:`（含 `--x :` 这种病态空白，折叠后已归一）
  const declared = new Set([...collapsed.matchAll(/(^|[;{}]\s*)(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[2] as string))
  return { refs, declared, fallbacks, body: collapsed }
}

function emittedVars(config: DesignThemeConfig, scheme: "light" | "dark" = "light"): Set<string> {
  const resolution = resolveDesignTheme(config, { scheme, activeThemeSeed: null, systemAccentAvailable: true })
  return new Set(Object.keys(resolution?.bundle.vars ?? {}))
}

function componentSets(names: Iterable<string>): Set<string> {
  const sets = new Set<string>()
  for (const name of names) {
    if (!name.startsWith(COMPONENT_PREFIX)) continue
    const rest = name.slice(COMPONENT_PREFIX.length)
    // 组件集名与 token 名都是 kebab-case，没有分隔符可分：用字典里的真实集名做最长前缀匹配。
    const owner = KNOWN_SETS.filter((set) => rest.startsWith(`${set}-`)).sort((a, b) => b.length - a.length)[0]
    if (owner) sets.add(owner)
  }
  return sets
}

/** 从生成字典现读的真实组件集名单——门禁不许自己猜集名。 */
const KNOWN_SETS: string[] = (() => {
  const generated = readFileSync(path.resolve(import.meta.dirname, "tokens.generated.ts"), "utf8")
  const clause = generated.match(/MD3_COMPONENT_SET_NAMES: readonly string\[\] = \[([\s\S]*?)\]/)
  if (!clause) throw new Error("tokens.generated.ts 里没有 MD3_COMPONENT_SET_NAMES——生成物形状漂移了")
  return [...clause[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1] as string)
})()

const mdCss = designCssFiles().map((file) => ({ file, ...parseCss(readFileSync(file, "utf8")) }))
const allRefs = new Set(mdCss.flatMap((entry) => [...entry.refs]))
const allDeclared = new Set(mdCss.flatMap((entry) => [...entry.declared]))

describe("advanced theme token coverage", () => {
  test("the CSS layer exists at all (an empty gate is not a passing gate)", () => {
    expect(designCssFiles().length, "src/styles/design/ 里应该至少有一份设计语言 CSS").toBeGreaterThan(0)
    expect(KNOWN_SETS.length, "字典里的组件集名单不该是空的").toBeGreaterThan(50)
  })

  test("md3 emits a non-empty bundle with every dimension on", () => {
    const vars = emittedVars({ ...DEFAULT_DESIGN_THEME, id: "md3", dimensions: { ...ALL_DIMENSIONS_ON } })
    // 颜色维度接管时全部桥接变量必须在场，少一条就是那条还在用上一个主题的残留。
    for (const name of BRIDGED_COLOR_VARS) expect(vars.has(name), `缺少桥接变量 ${name}`).toBe(true)
    expect(vars.size).toBeGreaterThan(BRIDGED_COLOR_VARS.length + 60)
  })

  test("direction 1: every engine-namespace var the CSS layer consumes is emitted", () => {
    const vars = emittedVars({ ...DEFAULT_DESIGN_THEME, id: "md3", dimensions: { ...ALL_DIMENSIONS_ON } })
    const missing: string[] = []
    for (const entry of mdCss) {
      const base = path.basename(entry.file)
      for (const ref of entry.refs) {
        if (!ref.startsWith("--md-sys-") && !ref.startsWith(COMPONENT_PREFIX) && !ref.startsWith("--md-ref-") && !ref.startsWith("--md3-")) continue
        if (vars.has(ref)) continue
        // `--md3-*` 是设计层自己的私有别名命名空间：不要求引擎发，但必须在本层定义过。
        // 定义可以落在任一份文件里——第一部分 @import 了第二部分，跨文件引用在运行时是合法的，
        // 逐文件判存在会把这种合法写法误报成违规。
        if (ref.startsWith("--md3-") && allDeclared.has(ref)) continue
        missing.push(`${base}: ${ref}`)
      }
    }
    expect(missing.sort(), "CSS 层引用了引擎没有发出的 token").toEqual([])
  })

  test("no --md-* var is consumed with a fallback value", () => {
    const offenders = mdCss.flatMap((entry) => [...entry.fallbacks]
      .filter((name) => name.startsWith("--md-"))
      .map((name) => `${path.basename(entry.file)}: ${name}`))
    // 缺值必须表现为看得见的坏掉，而不是悄悄落在一个近似值上。
    expect(offenders.sort(), "CSS 层不允许给 --md-* 变量写 fallback").toEqual([])
  })

  test("direction 2: emitted component sets are exactly the sets the CSS layer uses", () => {
    const vars = emittedVars({ ...DEFAULT_DESIGN_THEME, id: "md3", dimensions: { ...ALL_DIMENSIONS_ON } })
    const emittedSets = componentSets(vars)
    const usedSets = componentSets(allRefs)
    const unused = [...emittedSets].filter((set) => !usedSets.has(set)).sort()
    const unexpected = [...usedSets].filter((set) => !emittedSets.has(set)).sort()
    // 全表 3160 条 inline 变量是实打实的重排/重算成本；发了没人用＝死数据。
    expect(unused, `引擎发了没人消费的组件集：${unused.join(", ")}`).toEqual([])
    expect(unexpected, `CSS 层用到引擎没发的组件集：${unexpected.join(", ")}`).toEqual([])
    expect(usedSets.size, "至少要有 Tier-1 那批组件集在册").toBeGreaterThan(20)
  })

  test("the gauge sees violations (falsification controls)", () => {
    const vars = emittedVars({ ...DEFAULT_DESIGN_THEME, id: "md3", dimensions: { ...ALL_DIMENSIONS_ON } })
    // 豁免通道自己也得有内容：`flatMap` 少写一个展开会把 Set 当单个元素塞进去，
    // 于是 allDeclared 变成「Set 的集合」，`.has()` 永远 false —— 那种坏法不会让方向一松，
    // 只会让它一直红，所以这里把它当阳性对照钉住。
    expect(allDeclared.size, "私有别名豁免集合不能是空的").toBeGreaterThan(5)
    expect(allDeclared.has("--md3-state-layer-hover")).toBe(true)
    expect(allRefs.has("--md-comp-filled-button-container-height")).toBe(true)
    // 尺必须看得见三种坏：未知组件 token、未定义的私有别名、以及一个真存在的名字。
    const cases = [
      { css: "a { color: var(--md-comp-filled-button-does-not-exist); }", expectCaught: true },
      { css: "a { color: var(--md3-undefined-private-alias); }", expectCaught: true },
      { css: "a { --md3-defined-here: 1px; color: var(--md3-defined-here); }", expectCaught: false },
      { css: "a { color: var(--primary); }", expectCaught: false },
    ]
    for (const item of cases) {
      const parsed = parseCss(item.css)
      const offending = [...parsed.refs].filter((ref) => {
        if (vars.has(ref)) return false
        return !(ref.startsWith("--md3-") && parsed.declared.has(ref))
      })
      const caught = offending.length > 0
      expect(caught, `夹具应当${item.expectCaught ? "被抓住" : "放行"}：${item.css}`).toBe(item.expectCaught)
    }
    // 正向对照：同一把尺认得真发出来的变量。
    expect(vars.has("--primary")).toBe(true)
  })

  test("dimension switches genuinely stop emitting", () => {
    const shapeOff = emittedVars({
      ...DEFAULT_DESIGN_THEME,
      id: "md3",
      dimensions: { ...ALL_DIMENSIONS_ON, shape: false },
    })
    const colorOff = resolveDesignTheme(
      { ...DEFAULT_DESIGN_THEME, id: "md3", dimensions: { ...ALL_DIMENSIONS_ON, color: false } },
      { scheme: "dark", activeThemeSeed: "#123456", systemAccentAvailable: true },
    )
    expect([...shapeOff].some((name) => name.startsWith(MD3_VAR.shape)), "关掉 shape 之后还在发形状 token").toBe(false)
    expect(colorOff ? BRIDGED_COLOR_VARS.every((name) => !(name in colorOff.bundle.vars)) : false, "关掉 color 之后还在覆盖桥接变量").toBe(true)
  })
})

/**
 * 第二份配方（风格派）走同一把尺，但它的词汇表结构不同，所以「无人引用即红」的范围也不同：
 *  - `--stijl-color-*` 是**词表**（三原色 + 三非彩色这条原则的陈述），和 `--md-sys-*` 同等待遇，
 *    只核对「发出来的名字 == 词汇表」，不要求 CSS 层逐条读；
 *  - 非彩色那组（线宽/圆角/阴影/动效/间距/排版）是本仓的 UI 转译，没人读就是死数据，按双向核。
 */
describe("mondrian (De Stijl) token coverage", () => {
  const mondrian = resolveDesignTheme(
    { ...DEFAULT_DESIGN_THEME, id: "mondrian", dimensions: { ...ALL_DIMENSIONS_ON } },
    { scheme: "light", activeThemeSeed: null, systemAccentAvailable: true },
  )
  if (!mondrian) throw new Error("mondrian 配方没有在注册表里解析出来")
  const vars = new Set(Object.keys(mondrian.bundle.vars))
  const stijl = [...vars].filter((name) => name.startsWith(STIJL_VAR))
  const stijlColors = stijl.filter((name) => name.startsWith(`${STIJL_VAR}color-`))
  const stijlNonColour = stijl.filter((name) => !name.startsWith(`${STIJL_VAR}color-`))
  const cssStijlRefs = new Set(mdCss.flatMap((entry) => [...entry.refs].filter((ref) => ref.startsWith(STIJL_VAR))))

  test("the palette namespace is exactly the declared vocabulary", () => {
    expect(stijlColors.sort(), "`--stijl-color-*` 与 STIJL_COLOR_VARS 漂移").toEqual([...Object.values(STIJL_COLOR_VARS)].map((n) => `${STIJL_VAR}${n}`).sort())
    expect(stijlNonColour.sort(), "`--stijl-*` 非彩色组与 STIJL_GEOMETRY_VARS 漂移").toEqual([...STIJL_GEOMETRY_VARS].map((n) => `${STIJL_VAR}${n}`).sort())
    // 桥接侧不许漏：颜色维度接管时 36 条一条不少。
    for (const name of BRIDGED_COLOR_VARS) expect(vars.has(name), `缺少桥接变量 ${name}`).toBe(true)
  })

  test("direction 1: every --stijl-* the CSS layer reads is emitted", () => {
    const missing = mdCss.flatMap((entry) => [...entry.refs]
      .filter((ref) => ref.startsWith(STIJL_VAR) && !vars.has(ref))
      .map((ref) => `${path.basename(entry.file)}: ${ref}`))
    expect(missing.sort(), "CSS 层引用了风格派引擎没有发出的 token").toEqual([])
  })

  test("direction 2: every non-colour --stijl-* has a consumer in the CSS layer", () => {
    // 色板组按词汇表豁免（见本 describe 的注释），其余发了没人用＝死数据。
    const dead = stijlNonColour.filter((name) => !cssStijlRefs.has(name))
    expect(dead.sort(), `风格派发了没人消费的 UI 转译 token：${dead.join(", ")}`).toEqual([])
    expect(stijlNonColour.length, "非彩色组不该缩成空集").toBeGreaterThan(10)
  })

  test("no --stijl-* var is consumed with a fallback value", () => {
    const offenders = mdCss.flatMap((entry) => [...entry.fallbacks]
      .filter((name) => name.startsWith(STIJL_VAR))
      .map((name) => `${path.basename(entry.file)}: ${name}`))
    expect(offenders.sort(), "CSS 层不允许给 --stijl-* 变量写 fallback").toEqual([])
  })

  test("no border-radius literal survives in the De Stijl layer", () => {
    // 「圆角恒 0」必须是一个可查的来源（palette.ts 里 kind:"principle" 的那条），
    // 而不是散落在 CSS 里的十个 0 —— 后者改不动、也查不出是谁定的。
    const files = mdCss.filter((entry) => path.basename(entry.file) === "stijl-components.css")
    // 在**去注释**的正文上匹配：文件头的说明里会出现 `border-radius` 这个词，
    // 拿原文匹配会把解释当成违规（第一版就是这么红的）。
    const literals = files.flatMap((entry) => [...entry.body.matchAll(/border-radius:[^;}@!]*/g)]
      .map((m) => m[0].trim())
      .filter((decl) => !decl.includes("var(--stijl-radius)")))
    expect(literals, `CSS 里出现了不走 token 的 border-radius：${literals.join(" | ")}`).toEqual([])
    // 阳性对照：尺必须认得出一个真违规的字面量。
    const control = parseCss(".a { border-radius: 0; } .b { border-radius: var(--stijl-radius); }")
    const controlLiterals = [...control.body.matchAll(/border-radius:[^;}@!]*/g)]
      .map((m) => m[0].trim())
      .filter((decl) => !decl.includes("var(--stijl-radius)"))
    expect(controlLiterals, "夹具里的字面量 0 必须被抓到").toEqual(["border-radius: 0"])
  })

  test("the two recipes are genuinely independent, and each dimension switch bites", () => {
    const colorOff = resolveDesignTheme(
      { ...DEFAULT_DESIGN_THEME, id: "mondrian", dimensions: { ...ALL_DIMENSIONS_ON, color: false } },
      { scheme: "light", activeThemeSeed: null, systemAccentAvailable: true },
    )
    const shapeOff = resolveDesignTheme(
      { ...DEFAULT_DESIGN_THEME, id: "mondrian", dimensions: { ...ALL_DIMENSIONS_ON, shape: false, elevation: false } },
      { scheme: "light", activeThemeSeed: null, systemAccentAvailable: true },
    )
    expect(colorOff ? BRIDGED_COLOR_VARS.every((name) => !(name in colorOff.bundle.vars)) : false, "关掉 color 之后还在覆盖桥接变量").toBe(true)
    expect(colorOff ? Object.keys(colorOff.bundle.vars).some((n) => n.startsWith(`${STIJL_VAR}color-`)) : true, "关掉 color 之后还在发色板").toBe(false)
    expect(shapeOff ? `${STIJL_VAR}radius` in shapeOff.bundle.vars : true, "关掉 shape 之后还在发圆角").toBe(false)
    expect(shapeOff ? `${STIJL_VAR}shadow` in shapeOff.bundle.vars : true, "关掉 elevation 之后还在发阴影").toBe(false)
    // 结构线归 geometry+shape 共管：两个都关才算关。
    const lineOff = resolveDesignTheme(
      { ...DEFAULT_DESIGN_THEME, id: "mondrian", dimensions: { ...ALL_DIMENSIONS_ON, geometry: false, shape: false } },
      { scheme: "light", activeThemeSeed: null, systemAccentAvailable: true },
    )
    expect(lineOff ? `${STIJL_VAR}line-width` in lineOff.bundle.vars : true, "geometry/shape 都关之后还在发线宽").toBe(false)
  })

  test("the gauge sees violations in the De Stijl namespace (falsification controls)", () => {
    const cases = [
      { css: "a { color: var(--stijl-color-does-not-exist); }", expectCaught: true },
      { css: "a { border: var(--stijl-line-width-soft) solid var(--stijl-color-line); }", expectCaught: false },
      { css: "a { color: var(--stijl-color-line, #000); }", expectCaughtWithFallback: true },
      { css: "a { color: var(--primary); }", expectCaught: false },
    ]
    for (const item of cases) {
      const parsed = parseCss(item.css)
      const offending = [...parsed.refs].filter((ref) => ref.startsWith(STIJL_VAR) && !vars.has(ref))
      expect(offending.length > 0, `夹具应当${item.expectCaught ? "被抓住" : "放行"}：${item.css}`).toBe(item.expectCaught === true)
      if (item.expectCaughtWithFallback) {
        expect([...parsed.fallbacks].includes("--stijl-color-line"), "fallback 检测应当认出这条").toBe(true)
      }
    }
    // 反空对照：把某个真发出来的名字从 emit 集合里挖掉（模拟引擎退步），方向一必须立刻报它缺失。
    expect(cssStijlRefs.has("--stijl-line-width"), "阳性对照：线宽变量本来有人读").toBe(true)
    const crippled = new Set([...vars].filter((name) => name !== "--stijl-line-width"))
    const caught = [...cssStijlRefs].filter((ref) => !crippled.has(ref))
    expect(caught, "挖掉一条真发出来的变量之后，尺应当报它缺失").toEqual(["--stijl-line-width"])
    // 方向二同理：多出一条没人读的 UI 转译变量，必须被认出来。
    const padded = [...stijlNonColour, "--stijl-some-unused-token"]
    const dead = padded.filter((name) => !cssStijlRefs.has(name))
    expect(dead.includes("--stijl-some-unused-token"), "尺应当认出「发了没人读」的非彩色 token").toBe(true)
    expect(dead.filter((name) => name !== "--stijl-some-unused-token"), "现存非彩色 token 不许有无人消费的").toEqual([])
  })
})
