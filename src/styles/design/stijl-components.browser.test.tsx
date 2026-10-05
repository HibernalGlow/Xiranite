/**
 * 风格派组件层的真实渲染验收。
 *
 * 与 `md3-components.browser.test.tsx` 的关键区别：那边喂的是一份**手抄的 token 夹具**
 * （Google 字典太大，抄全套不现实），这边直接跑**真引擎** `applyDesignTheme()` ——
 * 配方只有 31 条变量，用夹具反而会多出一处会漂的副本（这条教训来自「夹具抄来的字面量要
 * 比对生产者」）。所以这里断言的每一个期望值都从生产者现读：颜色用 `mondrianScheme()` 算，
 * 尺寸从 CSS 变量读。
 *
 * 覆盖的成文约束（引文在 `mondrian/palette.ts`）：
 *  - 只用直线与矩形 → 圆角恒 0；
 *  - 不作明暗塑形 → 阴影恒 none；
 *  - 平面之间靠**结构线**分开，不靠投影；
 *  - 反馈用「对置」：悬停把地面色与动作色翻过来；
 *  - 组件皮肤优先：本层不碰 tabs/toggle-group/slider/scrollbar/field-label。
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { page } from "vitest/browser"
import { cleanup, render } from "vitest-browser-react"

import "./stijl-components.css"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ALL_DIMENSIONS_ON, DEFAULT_DESIGN_THEME, type DesignDimension, type DesignThemeConfig } from "@/lib/design-theme/contract"
import { applyDesignTheme, clearDesignTheme } from "@/lib/design-theme/apply"
import { mondrianScheme } from "@/lib/design-theme/mondrian/palette"
import { STIJL_ACCENT_ATTR, STIJL_GEOMETRY_VARS, STIJL_LINE_ATTR, STIJL_TOKEN_COUNT_ATTR, STIJL_VAR } from "@/lib/design-theme/mondrian/resolve"


const context = { scheme: "light" as const, activeThemeSeed: null, systemAccentAvailable: true }

/** 走真引擎：写 :root 的 inline 变量 + data-* 属性，和 `WorkspaceAppearance.tsx` 那条路径一致。 */
function applyMondrian(patch: Partial<DesignThemeConfig> = {}): DesignThemeConfig {
  const config: DesignThemeConfig = {
    ...DEFAULT_DESIGN_THEME,
    id: "mondrian",
    dimensions: { ...ALL_DIMENSIONS_ON },
    ...patch,
  }
  applyDesignTheme(config, context)
  return config
}

function el(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector)
  expect(node, `missing element: ${selector}`).not.toBeNull()
  return node as HTMLElement
}

function computed(selector: string, property: string): string {
  return getComputedStyle(el(selector)).getPropertyValue(property).trim()
}

function rgbOf(hex: string): string {
  const parts = [1, 3, 5].map((offset) => String(Number.parseInt(hex.slice(offset, offset + 2), 16)))
  return `rgb(${parts.join(", ")})`
}

/** 引擎写在 :root inline 上的那条变量值（生产者的真值，不是测试里的副本）。 */
function rootVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim()
}

/**
 * 关掉过渡与动画。
 *
 * 这不是为了让断言好过：本仓组件普遍带 `transition-*`（Button 是 `transition-all`），
 * 改完变量后**立刻**读 `getComputedStyle` 拿到的是过渡起点的值——第一版 4 条红里有 3 条
 * 是这件事（线宽 3px 读到 2px、换 accent 颜色没变、hover 后颜色没变），
 * 而引擎侧 `rootVar()` 已经证明值确实写下去了。颜色/尺寸的门禁要测的是「最终样式对不对」，
 * 所以这里把时间轴钉死，并在注释里留下这条，免得下一个人以为是测试写松了。
 */
let transitionKiller: HTMLStyleElement | null = null

beforeEach(() => {
  if (!transitionKiller) {
    transitionKiller = document.createElement("style")
    transitionKiller.textContent = "\n    *, *::before, *::after { transition-property: none !important; animation: none !important; }\n  " /* 用 transition-property 而不是 transition：`transition: none` 会把时长一起清零，motion 那组探针就测不到东西了。 */
    document.head.append(transitionKiller)
  }
})

afterEach(() => {
  cleanup()
  clearDesignTheme()
})

describe("mondrian surfaces", () => {
  test("zero radius and zero shadow on the Tier-1 surfaces", async () => {
    applyMondrian()
    await render(
      <Card>
        <CardHeader><CardTitle>Composition</CardTitle></CardHeader>
        <CardContent><Button>Apply</Button></CardContent>
      </Card>,
    )

    expect(rootVar(`${STIJL_VAR}radius`)).toBe("0")
    expect(computed('[data-slot="card"]', "border-top-left-radius")).toBe("0px")
    expect(computed('[data-slot="button"]', "border-top-left-radius")).toBe("0px")
    expect(computed('[data-slot="card"]', "box-shadow")).toBe("none")
  })

  test("positive control: without the recipe the same card is rounded and shadowed", async () => {
    await render(<Card><CardContent><Button>Apply</Button></CardContent></Card>)

    expect(computed('[data-slot="card"]', "border-top-left-radius")).not.toBe("0px")
    expect(computed('[data-slot="button"]', "border-top-left-radius")).not.toBe("0px")
    expect(computed('[data-slot="card"]', "box-shadow")).not.toBe("none")
  })

  test("planes are separated by the structural line, and its weight follows the setting", async () => {
    await render(<Card><CardContent>card</CardContent></Card>)

    applyMondrian({ mondrian: { accent: "red", lineWeight: 2 } })
    expect(rootVar(`${STIJL_VAR}line-width`), "引擎那步没写进去的话，下面的计算值断言会指错方向").toBe("2px")
    expect(computed('[data-slot="card"]', "border-top-width")).toBe("2px")
    expect(computed('[data-slot="card"]', "border-top-style")).toBe("solid")
    // 线的颜色 = 引擎发的那条（亮色方案下是量出来的黑），测试不重打这个值。
    expect(computed('[data-slot="card"]', "border-top-color")).toBe(rgbOf(rootVar(`${STIJL_VAR}color-line`)))

    applyMondrian({ mondrian: { accent: "red", lineWeight: 3 } })
    expect(rootVar(`${STIJL_VAR}line-width`)).toBe("3px")
    expect(computed('[data-slot="card"]', "border-top-width")).toBe("3px")
    expect(document.documentElement.getAttribute(STIJL_LINE_ATTR)).toBe("3")

    applyMondrian({ mondrian: { accent: "red", lineWeight: 1 } })
    expect(computed('[data-slot="card"]', "border-top-width")).toBe("1px")
  })

  test("separator and progress read as straight lines of the same weight", async () => {
    applyMondrian({ mondrian: { accent: "red", lineWeight: 2 } })
    await render(
      <>
        <Separator />
        <Progress value={40} />
      </>,
    )

    expect(computed('[data-slot="separator"]', "height")).toBe("2px")
    expect(computed('[data-slot="progress"]', "height")).toBe("2px")
    expect(computed('[data-slot="progress-indicator"]', "background-color")).toBe(rgbOf(rootVar(`${STIJL_VAR}color-accent`)))
  })
})

describe("mondrian action planes", () => {
  test("the filled button wears the accent plane and its contrast pair", async () => {
    applyMondrian({ mondrian: { accent: "red", lineWeight: 2 } })
    await render(<Button>Apply</Button>)

    const colors = mondrianScheme("light", "red")
    expect(rootVar(`${STIJL_VAR}color-accent`)).toBe(colors.planeAccent!.value)
    expect(computed('[data-slot="button"]', "background-color")).toBe(rgbOf(colors.planeAccent!.value))
    expect(computed('[data-slot="button"]', "color")).toBe(rgbOf(colors.onAccent!.value))
  })

  test("switching the accent plane really repaints the button", async () => {
    applyMondrian({ mondrian: { accent: "red", lineWeight: 2 } })
    await render(<Button>Apply</Button>)
    const red = computed('[data-slot="button"]', "background-color")
    expect(document.documentElement.getAttribute(STIJL_ACCENT_ATTR)).toBe("red")

    applyMondrian({ mondrian: { accent: "blue", lineWeight: 2 } })
    const blue = computed('[data-slot="button"]', "background-color")
    expect(blue).not.toBe(red)
    expect(blue).toBe(rgbOf(mondrianScheme("light", "blue").planeAccent!.value))
    expect(document.documentElement.getAttribute(STIJL_ACCENT_ATTR)).toBe("blue")
  })

  test("hover is opposition: ground and plane swap, no overlay layer", async () => {
    applyMondrian({ mondrian: { accent: "red", lineWeight: 2 } })
    await render(<Button>Apply</Button>)

    const before = computed('[data-slot="button"]', "background-color")
    await page.getByRole("button", { name: "Apply" }).hover()
    const hovered = computed('[data-slot="button"]', "background-color")

    expect(hovered, "悬停没改变底色，说明「对置」那条规则没生效").not.toBe(before)
    // 对置的定义：翻成地面色，而不是叠一层半透明（background-image 保持 none）。
    expect(hovered).toBe(rgbOf(rootVar(`${STIJL_VAR}color-ground`)))
    expect(computed('[data-slot="button"]', "background-image")).toBe("none")
  })

  test("no layout shift: default controls keep their native height, small ones stay small", async () => {
    await render(
      <>
        <Button>Apply</Button>
        <Button size="sm">Small</Button>
      </>,
    )
    const buttons = () => [...document.querySelectorAll<HTMLElement>('[data-slot="button"]')]
    const heights = () => buttons().map((node) => Number.parseFloat(getComputedStyle(node).height))
    const [nativeDefault, nativeSmall] = heights()
    expect(nativeDefault > nativeSmall, "阳性对照：默认档应当比 sm 档高，否则这条测不出被撑大").toBe(true)

    applyMondrian({ mondrian: { accent: "red", lineWeight: 2 } })
    const [afterDefault, afterSmall] = heights()
    expect(afterDefault).toBe(nativeDefault)
    expect(afterSmall).toBe(nativeSmall)
    // 这句就是 `--stijl-control-height` 那条出处（「等于本仓既有默认控件高度」）的机器版检查：
    // 值一改成本仓没有的数字，这里必红。
    expect(rootVar(`${STIJL_VAR}control-height`)).toBe(`${nativeDefault}px`)
  })
})

describe("mondrian dimension gating", () => {
  test("shape off returns the radius to the app's own value", async () => {
    await render(<Card><CardContent>x</CardContent></Card>)
    const native = computed('[data-slot="card"]', "border-top-left-radius")

    applyMondrian()
    expect(rootVar(`${STIJL_VAR}radius`)).toBe("0")
    const styled = computed('[data-slot="card"]', "border-top-left-radius")
    applyMondrian({ dimensions: { ...ALL_DIMENSIONS_ON, shape: false } })
    const gated = computed('[data-slot="card"]', "border-top-left-radius")

    expect(styled).toBe("0px")
    expect(gated).toBe(native)
    expect(rootVar(`${STIJL_VAR}radius`)).toBe("")
  })

  test("elevation off stops forcing the shadow away", async () => {
    await render(<Card><CardContent>x</CardContent></Card>)
    applyMondrian({ dimensions: { ...ALL_DIMENSIONS_ON, elevation: false } })
    expect(rootVar(`${STIJL_VAR}shadow`)).toBe("")
    expect(computed('[data-slot="card"]', "box-shadow")).not.toBe("none")
  })

  test("colour off leaves the palette unset and the app colours in place", async () => {
    applyMondrian({ dimensions: { ...ALL_DIMENSIONS_ON, color: false } })
    await render(<Button>Apply</Button>)
    expect(rootVar(`${STIJL_VAR}color-accent`)).toBe("")
    expect(rootVar("--primary")).toBe("")
    // 回读属性必须等于「DOM 上真有几条 --stijl-*」，不是词汇表长度：
    // 前者是实盘，后者手抄一份就会漂（这正是 `data-stijl-tokens` 存在的理由）。
    const inline = [...document.documentElement.style].filter((name) => name.startsWith(STIJL_VAR))
    expect(document.documentElement.getAttribute(STIJL_TOKEN_COUNT_ATTR)).toBe(String(inline.length))
    expect(inline.length, "关掉颜色之后应当只剩非彩色那一组").toBe(STIJL_GEOMETRY_VARS.length)
  })
})

/** 探针 → 它归哪个维度管。这里的归属必须和 `mondrian/resolve.ts` 的 owner 表一致。 */
interface Probe {
  selector: string
  prop: string
  dim: Exclude<DesignDimension, "states">
}

const PROBES: readonly Probe[] = [
  { selector: '[data-slot="card"]', prop: "border-top-left-radius", dim: "shape" },
  { selector: '[data-slot="card"]', prop: "box-shadow", dim: "elevation" },
  { selector: '[data-slot="card"]', prop: "border-top-width", dim: "geometry" },
  { selector: '[data-slot="card"]', prop: "padding-top", dim: "geometry" },
  { selector: '[data-slot="card-title"]', prop: "font-size", dim: "typography" },
  { selector: '[data-slot="button"]', prop: "border-top-left-radius", dim: "shape" },
  { selector: '[data-slot="button"]', prop: "background-color", dim: "color" },
  { selector: '[data-slot="button"]', prop: "color", dim: "color" },
  { selector: '[data-slot="button"]', prop: "transition-duration", dim: "motion" },
  { selector: '[data-slot="separator"]', prop: "height", dim: "geometry" },
] as const satisfies readonly Probe[]

async function probeFixture(): Promise<void> {
  await render(
    <>
      <Card>
        <CardHeader><CardTitle>Composition</CardTitle></CardHeader>
        <CardContent><Button>Apply</Button><Button variant="outline">Away</Button></CardContent>
      </Card>
      <Separator />
    </>,
  )
}

function snapshotFor(probes: readonly Probe[]): string[] {
  return probes.map((probe) => computed(probe.selector, probe.prop))
}

describe("mondrian dimension switches revert to the app, not to a broken value", () => {
  /*
    这条测的是那一类只在运行期暴露的坏法：规则写了 `var(--stijl-x)` 但没挂对应的维度门。
    关掉那个维度时引擎不再发 `--stijl-x`，而未定义变量参与的声明会按「非法值 → 取该属性的
    初始值」结算（`border-radius` 的初始值是 0，不是本仓的 10px）。也就是说构建全绿、
    CSS 也不报错，画面上却出现一个既不是配方也不是原样的第三种状态 ——
    第一版风格派层就是这样漏了 4 条没门控的圆角规则，被这条抓到。

    注意口径：关掉**一个**维度只该让**它自己那组**属性回到原样，其余属性必须留在配方值上。
    所以每个维度只测自己名下的探针，并且要求它名下至少有一条探针在配方打开时确实变过
    （否则「关掉它没变化」和「关掉它回到原样」都测不出东西）。
  */
  for (const dimension of ["color", "shape", "elevation", "typography", "motion", "geometry"] as const) {
    test(`only ${dimension} off puts its own properties back and keeps the rest styled`, async () => {
      await probeFixture()
      const owned = PROBES.filter((probe) => probe.dim === dimension)
      expect(owned.length, `${dimension} 名下没有探针，这条是空的`).toBeGreaterThan(0)

      const native = snapshotFor(owned)
      applyMondrian()
      const styled = snapshotFor(owned)
      applyMondrian({ dimensions: { ...ALL_DIMENSIONS_ON, [dimension]: false } })
      const reverted = snapshotFor(owned)

      const bites = owned.map((probe, index) => `${probe.selector} ${probe.prop}: ${native[index]} → ${styled[index]}`)
      expect(styled, `${dimension} 打开时没有任何一条名下探针变化（这条测不出东西）：${bites.join(" | ")}`).not.toEqual(native)
      expect(reverted, `关掉 ${dimension} 之后没有回到本仓原样：${bites.join(" | ")}`).toEqual(native)

      // 其余维度必须不受牵连：把它们名下探针按「仍等于配方值」再核一遍。
      const others = PROBES.filter((probe) => probe.dim !== dimension)
      expect(snapshotFor(others), `关掉 ${dimension} 时牵连到了别的维度`).toEqual(snapshotForAllStyled(others))
    })
  }

  test("states off stops the opposition swap on hover", async () => {
    await probeFixture()
    // 用 role 定位而不是选择器：`page` 在这套 harness 里是 ARIA 查询对象，没有 locator()。
    const overApply = () => page.getByRole("button", { name: "Apply" }).hover()
    const buttonBackground = () => computed('[data-slot="button"]', "background-color")

    applyMondrian()
    const base = await readUnhovered(buttonBackground)
    const swapped = await hoverWhile(overApply, buttonBackground)
    expect(swapped, "states 开着时悬停没换色").not.toBe(base)
    expect(swapped, "对置应当翻成地面色，而不是叠一层半透明").toBe(rgbOf(rootVar(`${STIJL_VAR}color-ground`)))
    expect(computed('[data-slot="button"]', "background-image"), "不许用叠加层表达悬停").toBe("none")

    applyMondrian({ dimensions: { ...ALL_DIMENSIONS_ON, states: false } })
    const gated = await hoverWhile(overApply, buttonBackground)
    expect(gated, "关掉 states 之后还在做对置").not.toBe(swapped)
    /*
      期望是「和不悬停一样」，不是「回到本仓的 hover:bg-primary/90」：
      本层那条动作面规则的选择器比那条工具类更具体，所以它一直赢 ——
      也就是说关掉 states 之后这个按钮**没有**悬停反馈。这是选择这条实现路径的已知代价，
      写在这里而不是藏起来；要改得把颜色规则做成 `:not(:hover)`，那是另一轮的事。
    */
    expect(gated, "关掉 states 之后不该再有颜色翻转").toBe(base)
  })
})

/**
 * 悬停 → 读值 → 把鼠标让给旁边那个按钮。
 *
 * 让开这一步是必需的：Playwright 的悬停是真实指针状态，不会随 `applyDesignTheme` 复位，
 * 上一次悬停残留会让下一个「未悬停」的读数拿到悬停值（第一版就是这样把 base 读成 swapped 的）。
 */
async function hoverWhile<T>(hover: () => Promise<void>, read: () => T): Promise<T> {
  await hover()
  const value = read()
  await page.getByRole("button", { name: "Away" }).hover()
  return value
}

/** 读一个「没有悬停」状态下的值：先把鼠标停在别的按钮上。 */
async function readUnhovered<T>(read: () => T): Promise<T> {
  await page.getByRole("button", { name: "Away" }).hover()
  return read()
}

/** 关掉某维度后，别的维度名下探针应当停在配方值上——这份「配方值」现读一次，不手抄。 */
function snapshotForAllStyled(probes: readonly Probe[]): string[] {
  applyMondrian()
  return snapshotFor(probes)
}
