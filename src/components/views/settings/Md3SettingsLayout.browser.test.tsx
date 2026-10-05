import { page } from "vitest/browser"
import { afterEach, describe, expect, test } from "vitest"
import { render } from "vitest-browser-react"

// 与 src/main.tsx 同一批样式入口。少 import 一份，MD3 层就不在文档里，
// 测试会全绿而界面是坏的——2026-10-05 就是这么漏过去一次的，本文件为堵这个洞而存在。
import "@/styles/tailwind.css"
import "@/index.css"
import "@/styles/themes/index.css"
import "@/styles/design/md3-components.css"
import "@/styles/design/md3-settings-nav.css"

import { AppearanceSection } from "@/components/views/settings/AppearanceSection"
import { SettingsSearch } from "@/components/views/settings/SettingsSearch"
import { SettingsStageNav } from "@/components/views/settings/SettingsStageNav"
import { WorkspaceAppearance } from "@/components/workspace/WorkspaceAppearance"
import { DEFAULT_DESIGN_THEME, type DesignThemeConfig } from "@/lib/design-theme/contract"
import i18n from "@/i18n"
import { useWorkspaceStore } from "@/store/workspaceStore"

/**
 * 设置页在**真实级联**下的尺寸回归尺。
 *
 * 三条规矩：
 *  1. 量 `getComputedStyle` / `getBoundingClientRect` 的计算值，不是类名字符串；
 *  2. 断言一律配「MD3 关掉」的对照——只比绝对数字会被基线本身骗过去；
 *  3. 截图落盘并且要有人看：断言只能证明没超出带宽，证明不了不难看。
 */
const NAV_STAGE = "[data-settings-nav-stage]"
const NAV_STEP = "[data-settings-nav-step]"
const TRIGGER = "[data-slot='select-trigger']"

interface Box {
  fontSize: number
  height: number
  radius: string
}

function probe(selector: string): Box | null {
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return null
  const cs = getComputedStyle(el)
  return {
    fontSize: Math.round(Number.parseFloat(cs.fontSize)),
    height: Math.round(el.getBoundingClientRect().height),
    radius: cs.borderTopLeftRadius,
  }
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

interface Snapshot {
  stage: Box | null
  step: Box | null
  trigger: Box | null
}

function snapshot(): Snapshot {
  return { stage: probe(NAV_STAGE), step: probe(NAV_STEP), trigger: probe(TRIGGER) }
}

async function mount(config: DesignThemeConfig) {
  await i18n.changeLanguage("zh-CN")
  useWorkspaceStore.getState().setDesignTheme(config)
  render(
    <div data-testid="md3-page" style={{ display: "flex", width: 1180, height: 760, border: "1px solid gray" }}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <WorkspaceAppearance />
        <SettingsSearch onSelect={() => {}} />
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <SettingsStageNav
            section="appearance"
            activeStep="design-language"
            onSectionChange={() => {}}
            onStepSelect={() => {}}
            expandAll
          />
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 16 }}>
            <AppearanceSection />
          </div>
        </div>
      </div>
    </div>,
  )
  // vitest 的 page 没有 waitForSelector：自己轮询到真元素出现再量。
  for (let attempt = 0; attempt < 100 && document.querySelector(NAV_STAGE) === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

/** 等 `:root` 上的 token 换完（选中态圆角是最快的可见信号），再量。 */
async function remeasure(config: DesignThemeConfig): Promise<Snapshot> {
  useWorkspaceStore.getState().setDesignTheme(config)
  const wantRadius = config.id === "native" ? "4px" : "9999px"
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (probe(NAV_STAGE)?.radius === wantRadius) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return snapshot()
}

afterEach(() => {
  useWorkspaceStore.getState().setDesignTheme({ ...DEFAULT_DESIGN_THEME })
  document.documentElement.removeAttribute("style")
})

describe("settings page keeps its density under MD3", () => {
  test("native baseline → md3 must not grow the controls by more than one step", async () => {
    await mount({ ...DEFAULT_DESIGN_THEME })
    const off = snapshot()
    await page.getByTestId("md3-page").screenshot({ path: ".cache/md3-page-off.png" })
    expect(off.stage, "原生基线没渲染出来，后面的差值断言全是空转").not.toBeNull()

    const on = await remeasure({ ...DEFAULT_DESIGN_THEME, id: "md3" })
    await page.getByTestId("md3-page").screenshot({ path: ".cache/md3-page-on.png" })
    console.log(JSON.stringify({ off, on, barLabel: token("--md-comp-navigation-bar-label-text-size") }))
    expect(on.stage).not.toBeNull()
    expect(on.step).not.toBeNull()

    // 阳性对照：drawer 那套（56dp 行 / label-large 14px）确实比紧凑档大。
    // 没有这一条，「条目用的是 bar 而不是 drawer」就只是注释里的一句话。
    expect(token("--md-comp-navigation-drawer-active-indicator-height")).toBe("56px")
    expect(token("--md-comp-navigation-bar-label-text-size")).toBe("0.75rem")

    expect(on.stage!.fontSize, "条目字号又抬回 drawer 的 label-large 了").toBe(12)
    expect(on.step!.fontSize).toBe(12)
    // 行高允许比原生高一档（M3 的触控下限把 29→32、36→40，这是有意的）；
    // 回到 drawer 的 56 会一次涨 20dp，正是 2026-10-05 用户看到的那次变形。
    expect(on.stage!.height - off.stage!.height).toBeLessThanOrEqual(6)
    expect(on.step!.height - off.step!.height).toBeLessThanOrEqual(6)
    expect(on.stage!.height).toBeLessThanOrEqual(44)
    expect(on.step!.height).toBeLessThanOrEqual(36)
    // 一个目的地一条指示条：静止条目是透明的，所以「有底色」的条目数就是被画的指示条数。
    // 父级（外观）与子级（设计语言）同时带 aria-current，正是用户实机看到的双胶囊场景。
    const painted = [...document.querySelectorAll(`${NAV_STAGE}, ${NAV_STEP}`)].filter(
      (el) => getComputedStyle(el as HTMLElement).backgroundColor !== "rgba(0, 0, 0, 0)",
    )
    console.log(`PAINTED ${String(painted.length)} ${JSON.stringify(painted.map((el) => el.getAttribute("aria-current") && (el.getAttribute("data-settings-nav-step") ?? el.getAttribute("data-settings-nav-stage"))))}`)
    expect(painted.length, `抽屉里画了 ${String(painted.length)} 条选中指示条，主级与子级同色就没有层级了`).toBe(1)
    expect(painted[0].getAttribute("data-settings-nav-step"), "被画的是父级分组头，而不是选中的子项").toBe("design-language")

    if (on.trigger !== null && off.trigger !== null) {
      expect(on.trigger.height - off.trigger.height).toBeLessThanOrEqual(8)
      expect(on.trigger.fontSize, "字段字号被 body-large 接管了（见 Deviation (c)）").toBeLessThanOrEqual(14)
    }
  })
})
