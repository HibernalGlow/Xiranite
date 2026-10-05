import { beforeAll, beforeEach, describe, expect, test } from "vitest"
import { render } from "vitest-browser-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { ALL_DIMENSIONS_ON, DEFAULT_DESIGN_THEME, type DesignThemeConfig } from "@/lib/design-theme/contract"
import { applyDesignTheme, clearDesignTheme } from "@/lib/design-theme/apply"
import { WULING_PRESET_COLORS } from "@/lib/design-theme/wuling/spec"
import "../../index.css"
import "./wuling-components.css"

/**
 * 武陵配方的浏览器尺。三件事，每件都只有真 chrominum 能说：
 *  1. 引擎真的把 `--wl-*` 写到 `:root`，并且**组件读到了**（引用而无人发＝画面上坏掉）；
 *  2. 默认档位下画面等于旧预设——「保留现有预设的风格」不是口号，是这一条；
 *  3. 关掉某一个维度，那一维的探针必须**回到本仓原样**（不是回到 0，也不是回到配方值）。
 *
 * 第 3 条是本仓踩过两次的形状：`var()` 未定义时声明落到属性初始值，
 * 于是「关掉圆角」看起来像「圆角变成 0」而不是「沿用原来的 10px」。
 * 所以每条断言都是 `styled ≠ native` 且 `reverted == native` 两头一起要。
 *
 * 关掉 transition 用 `transition-property`，不用 `transition: none`——后者把时长也归零，
 * 之后想测动效就没有条件了（同一条经验在风格派那份里记着）。
 */

const root = document.documentElement

function wulingConfig(patch: Partial<DesignThemeConfig> = {}): DesignThemeConfig {
  return { ...DEFAULT_DESIGN_THEME, id: "wuling", dimensions: { ...ALL_DIMENSIONS_ON }, ...patch }
}

function apply(config: DesignThemeConfig) {
  applyDesignTheme(config, { scheme: "light", activeThemeSeed: null, systemAccentAvailable: false })
}

function computed(selector: string, property: string): string {
  const node = document.querySelector<HTMLElement>(selector)
  expect(node, `页面上找不到 ${selector}`).toBeTruthy()
  return getComputedStyle(node as HTMLElement).getPropertyValue(property).trim()
}

async function mountControls() {
  await render(
    <div className="wuling-dl-probe p-6">
      <Card>
        <div className="p-3">card</div>
      </Card>
      <Button size="sm">Apply</Button>
      <Input aria-label="probe field" />
      <Badge variant="secondary">Badge</Badge>
    </div>,
  )
}

/** 「本仓原样」的底片：关掉整条设计语言之后，这些探针该回到哪儿。 */
const nativeBaseline: Record<string, string> = {}

beforeAll(() => {
  const style = document.createElement("style")
  style.textContent = "*, *::before, *::after { transition-property: none !important; animation: none !important; }"
  document.head.append(style)
})

// 这个 provider 会在每条测试之间清掉挂载点（第一版把 mount 放在 beforeAll 里，
// 于是第二条之后的探针全部 null——尺子量不到任何东西，正符合「假绿」的形状）。
// 所以每条测试都要自己挂一遍，并在引擎动手之前先照一张本仓原样的底片。
beforeEach(async () => {
  clearDesignTheme()
  await mountControls()
  nativeBaseline.badgeRadius = computed('[data-slot="badge"]', "border-top-left-radius")
  nativeBaseline.badgeCase = computed('[data-slot="badge"]', "text-transform")
  nativeBaseline.cardRadius = computed('[data-slot="card"]', "border-top-left-radius")
  nativeBaseline.cardShadow = computed('[data-slot="card"]', "box-shadow")
  nativeBaseline.buttonRadius = computed('[data-slot="button"]', "border-top-left-radius")
})

describe("wuling design language reaches the components", () => {
  test("the native baseline really is un-ledgy (so the probes can move)", () => {
    // 探针有效性的前提：原生状态下 badge 的角半径不是 4px 那一档、标签不是大写。
    // 如果这里已经是配方值，下面所有「变成 4px」的断言都是空话。
    expect(nativeBaseline.badgeRadius, "原生 badge 已经是 4px，这条尺测不出东西").not.toBe("4px")
    expect(nativeBaseline.badgeCase, "原生 badge 已经是大写，这条尺测不出东西").not.toBe("uppercase")
  })

  test("the engine writes the ladder and the components read it", () => {
    apply(wulingConfig())
    expect(root.style.getPropertyValue("--wl-corner-chip").trim()).toBe("4px")
    expect(root.getAttribute("data-app-design")).toBe("wuling")
    expect(root.getAttribute("data-wuling-corner")).toBe("1")
    expect(root.getAttribute("data-wuling-labels")).toBe("ledger")
    expect(computed('[data-slot="badge"]', "border-top-left-radius")).toBe("4px")
    expect(computed('[data-slot="button"]', "border-top-left-radius")).toBe("4px")
    // 计算值报 px（0.5rem = 8px）：钉的是「阶梯真的落到组件上」，不是单位写法。
    expect(computed('[data-slot="card"]', "border-top-left-radius")).toBe("8px")
    expect(computed('[data-slot="badge"]', "text-transform")).toBe("uppercase")
    expect(computed('[data-slot="badge"]', "font-family")).toContain("mono")
  })

  test("default tiers paint exactly the colours the surviving preset declares", async () => {
    apply(wulingConfig())
    const probe = document.createElement("div")
    probe.className = "theme-wuling"
    root.append(probe)
    try {
      const presetStyles = getComputedStyle(probe)
      for (const [name, value] of Object.entries(WULING_PRESET_COLORS.light)) {
        // 配方写在 :root inline，预设写在 .theme-wuling 类上；两条必须给出同一个值。
        expect(getComputedStyle(root).getPropertyValue(name).trim(), `配方发的 ${name} 与预设不一致`).toBe(value)
        expect(presetStyles.getPropertyValue(name).trim(), `预设自己没了 ${name}`).toBe(value)
      }
    } finally {
      probe.remove()
    }
  })

  test("turning one dimension off reverts only that dimension", () => {
    // 先开配方，再取「开着的样子」——上一条测试结束时 DOM 已被 provider 清过，
    // 这里如果先读后 apply，读到的就是本仓原样（badge 是 rounded-full），断言会假红。
    apply(wulingConfig())
    const styled = {
      badgeRadius: computed('[data-slot="badge"]', "border-top-left-radius"),
      badgeCase: computed('[data-slot="badge"]', "text-transform"),
      cardShadow: computed('[data-slot="card"]', "box-shadow"),
      cardRadius: computed('[data-slot="card"]', "border-top-left-radius"),
    }
    expect(styled.badgeRadius).toBe("4px")

    // 关掉 typography：标签回到原生，圆角与投影必须留下。
    apply(wulingConfig({ dimensions: { ...ALL_DIMENSIONS_ON, typography: false } }))
    const typoOff = {
      badgeRadius: computed('[data-slot="badge"]', "border-top-left-radius"),
      badgeCase: computed('[data-slot="badge"]', "text-transform"),
      cardShadow: computed('[data-slot="card"]', "box-shadow"),
    }
    expect(typoOff.badgeCase).not.toBe("uppercase")
    expect(typoOff.badgeRadius, "关 typography 牵连掉了 shape").toBe(styled.badgeRadius)
    expect(typoOff.cardShadow, "关 typography 牵连掉了 elevation").toBe(styled.cardShadow)

    // 关掉 shape：回到本仓原样，不是 0px。
    apply(wulingConfig({ dimensions: { ...ALL_DIMENSIONS_ON, shape: false } }))
    const shapeOffRadius = computed('[data-slot="badge"]', "border-top-left-radius")
    expect(shapeOffRadius).not.toBe("0px")
    expect(shapeOffRadius).not.toBe(styled.badgeRadius)
    expect(computed('[data-slot="badge"]', "text-transform"), "关 shape 牵连掉了 typography").toBe("uppercase")

    // 全关 = 与 native 底片逐条相同（不是「回到 0」，也不是「留在配方值」）。
    apply(wulingConfig({ dimensions: Object.fromEntries(
      Object.keys(ALL_DIMENSIONS_ON).map((key) => [key, false]),
    ) as DesignThemeConfig["dimensions"] }))
    expect(computed('[data-slot="badge"]', "border-top-left-radius"), "维度全关后 badge 角半径没回到本仓原样").toBe(nativeBaseline.badgeRadius)
    expect(computed('[data-slot="badge"]', "text-transform"), "维度全关后 badge 大小写没回到本仓原样").toBe(nativeBaseline.badgeCase)
    expect(computed('[data-slot="card"]', "border-top-left-radius"), "维度全关后卡片角半径没回到本仓原样").toBe(nativeBaseline.cardRadius)
    expect(computed('[data-slot="card"]', "box-shadow"), "维度全关后卡片投影没回到本仓原样").toBe(nativeBaseline.cardShadow)

    // 阳性对照：这条尺看得见「没回到原样」——把整条语言重新打开，值必须又离开底片。
    apply(wulingConfig())
    expect(computed('[data-slot="badge"]', "border-top-left-radius")).not.toBe(nativeBaseline.badgeRadius)
    clearDesignTheme()
    expect(computed('[data-slot="badge"]', "border-top-left-radius"), "clearDesignTheme 之后必须回到底片").toBe(nativeBaseline.badgeRadius)
  })

  test("the corner ladder scales as a unit and readback says so", () => {
    apply(wulingConfig({ wuling: { ...DEFAULT_DESIGN_THEME.wuling, cornerScale: 1.5 } }))
    expect(root.getAttribute("data-wuling-corner")).toBe("1.5")
    expect(computed('[data-slot="badge"]', "border-top-left-radius")).toBe("6px")
    apply(wulingConfig({ wuling: { ...DEFAULT_DESIGN_THEME.wuling, seed: "#b3261e", seedSource: "manual" } }))
    expect(root.getAttribute("data-wuling-seed")).toBe("#b3261e")
    expect(root.getAttribute("data-wuling-seed-source")).toBe("manual")
    expect(root.getAttribute("data-wuling-seed-fallback")).toBe("false")
    // 取色真的换了画面上的主色，而不是只换了属性。
    expect(getComputedStyle(root).getPropertyValue("--primary").trim()).not.toBe(WULING_PRESET_COLORS.light["--primary"])
  })
})
