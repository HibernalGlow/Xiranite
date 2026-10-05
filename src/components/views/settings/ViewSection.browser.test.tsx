import { afterEach, describe, expect, test } from "vitest"
import { render } from "vitest-browser-react"

import i18n from "@/i18n"
import { WorkspaceAppearance } from "@/components/workspace/WorkspaceAppearance"
import { useWorkspaceStore } from "@/store/workspaceStore"
import { CHOICE_CONTROL_STYLES, FIELD_TITLE_STYLES } from "@/components/ui/choice-control-variants"
import { SCROLLBAR_DISPLAY_STYLES } from "@/components/ui/scrollbar-variants"
import { SLIDER_DISPLAY_STYLES } from "@/components/ui/slider-variants"
import { SWITCH_DISPLAY_STYLES } from "@/components/ui/switch-variants"
import { TAB_DISPLAY_STYLES } from "@/components/ui/tabs-variants"
import { INITIAL_STATE } from "@/store/workspace/constants"
import { ViewSection } from "./ViewSection"

/**
 * 「不接管」这一档必须在**界面上真的可选**，并且选下去真的让 `:root` 上那个属性消失。
 *
 * 词表/白名单/标签的一致性由 `componentSkinVocabulary.test.ts` 静态查，那条查不到
 * 「面板有没有把它渲染出来、点了有没有走到 store 与 DOM」。这条补的就是那一段：
 * 设置面板 → store → `WorkspaceAppearance` → `documentElement.dataset`。
 */
/** 标签从 i18n 现读，不在测试里抄一份英文字面量（抄了就会漂：`legend` 的标签其实是
 * "Floating legend"，第一版按「首字母大写」断言就是因此红的）。 */
import en from "@/i18n/locales/en.json"

const FAMILIES = [
  { dataset: "tabsStyle", field: "tabDisplayStyle", setter: "setTabDisplayStyle", values: TAB_DISPLAY_STYLES, path: ["settings", "view", "componentDisplay", "styles"], distinctive: "underline" },
  { dataset: "switchStyle", field: "switchDisplayStyle", setter: "setSwitchDisplayStyle", values: SWITCH_DISPLAY_STYLES, path: ["settings", "view", "componentDisplay", "switches", "styles"], distinctive: "outlined" },
  { dataset: "sliderStyle", field: "sliderDisplayStyle", setter: "setSliderDisplayStyle", values: SLIDER_DISPLAY_STYLES, path: ["settings", "view", "componentDisplay", "sliders", "styles"], distinctive: "solid" },
  { dataset: "scrollbarStyle", field: "scrollbarDisplayStyle", setter: "setScrollbarDisplayStyle", values: SCROLLBAR_DISPLAY_STYLES, path: ["settings", "view", "componentDisplay", "scrollbars", "styles"], distinctive: "thin" },
  { dataset: "choiceControlStyle", field: "choiceControlStyle", setter: "setChoiceControlStyle", values: CHOICE_CONTROL_STYLES, path: ["settings", "timeline", "choice"], distinctive: "segmented" },
  { dataset: "fieldTitleStyle", field: "fieldTitleStyle", setter: "setFieldTitleStyle", values: FIELD_TITLE_STYLES, path: ["settings", "timeline", "fieldTitle"], distinctive: "stacked" },
] as const

function labelsFor(path: readonly string[]): Record<string, string> {
  let node: unknown = en
  for (const part of path) node = (node as Record<string, unknown>)[part]
  return node as Record<string, string>
}

function groups(): HTMLElement[] {
  // 每一族是一个 Radix ToggleGroup（role=group）；用「组里有没有这一族独有的档位名」来定位，
  // 因为「None」六族都有，按名字查会一次撞六个。
  return [...document.querySelectorAll<HTMLElement>('[role="group"]')]
}

function groupWith(label: string): HTMLElement {
  const found = groups().find((group) => [...group.querySelectorAll("button")].some((b) => b.textContent?.trim() === label))
  expect(found, `找不到含「${label}」档位的皮肤组`).toBeTruthy()
  return found as HTMLElement
}

function clickButton(group: HTMLElement, label: string): void {
  const button = [...group.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)
  expect(button, `这一组里没有「${label}」这一档`).toBeTruthy()
  ;(button as HTMLButtonElement).click()
}

async function renderPanel() {
  await i18n.changeLanguage("en")
  render(
    <>
      <WorkspaceAppearance />
      <ViewSection />
    </>,
  )
  await new Promise((resolve) => { setTimeout(resolve, 60) })
}

afterEach(() => {
  const actions = useWorkspaceStore.getState() as unknown as Record<string, (value: string) => void>
  for (const family of FAMILIES) {
    actions[family.setter]((INITIAL_STATE as unknown as Record<string, string>)[family.field])
  }
  document.body.replaceChildren()
})

describe("the 不接管 tier is selectable in the settings panel", () => {
  test("every skin family renders a None option", async () => {
    await renderPanel()
    for (const family of FAMILIES) {
      // 标签从 i18n 现读再比对：这些文案是人写的（fieldTitle 的 legend 实际叫
      // 「Floating legend」），在测试里猜字面量一定会漂。
      const table = labelsFor(family.path)
      const group = groupWith(table[family.distinctive])
      const rendered = [...group.querySelectorAll("button")].map((b) => b.textContent?.trim())
      expect(rendered, `${family.dataset} 渲染的档位与词表/标签不符：${rendered.join(" / ")}`)
        .toEqual(family.values.map((value) => table[value]))
      expect(rendered, `${family.dataset} 缺「不接管」档`).toContain(table.none)
    }
  })

  test("picking None removes the attribute and picking a real tier puts it back", async () => {
    await renderPanel()
    const root = document.documentElement
    const labels = labelsFor(["settings", "timeline", "choice"])
    const group = groupWith(labels.segmented)

    expect(root.dataset.choiceControlStyle, "默认应当仍在接管（segmented）").toBe("segmented")

    clickButton(group, labels.none)
    await new Promise((resolve) => { setTimeout(resolve, 60) })
    expect(useWorkspaceStore.getState().choiceControlStyle).toBe("none")
    expect("choiceControlStyle" in root.dataset, "选了不接管但属性还挂在 :root 上").toBe(false)

    clickButton(group, labels.tiles)
    await new Promise((resolve) => { setTimeout(resolve, 60) })
    expect(root.dataset.choiceControlStyle).toBe("tiles")
  })
})
