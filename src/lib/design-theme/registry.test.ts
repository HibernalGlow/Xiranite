import { describe, expect, test } from "vitest"

import en from "@/i18n/locales/en.json"
import zh from "@/i18n/locales/zh.json"
import {
  ALL_DIMENSIONS_ON,
  DEFAULT_DESIGN_THEME,
  WULING_CORNER_STEPS,
  normalizeDesignThemeConfig,
  type DesignThemeConfig,
} from "./contract"
import { DESIGN_THEME_ENTRIES, resolveDesignTheme } from "./registry"
import { WULING_PRESET_COLORS } from "./wuling/spec"

/**
 * 注册表这条链上最容易「静默半边失效」的不是解析器，是那张手抄清单：
 * 每加一份配方，至少要同时动 registry、契约里的 options、i18n（中英两份）、设置面板分支。
 * 少一个标签界面上就是一个裸 key；少一个分支就是一份「能选到但没有任何控件」的装饰品
 * （本仓真的有过一次「三档组件皮肤没有 CSS 消费者」）。
 */
type Table = Record<string, unknown>

function dig(table: Table, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Table)[part] : undefined), table)
}

/** `settings:designTheme.wuling.label` → settings → designTheme → wuling → label。 */
function keyPath(key: string): string[] {
  const [namespace, ...rest] = key.split(":")
  expect(namespace, `注册表里的 key 都应当带命名空间：${key}`).toBe("settings")
  return rest.join(":").split(".")
}

describe("the design-language registry stays wired on every side", () => {
  test("every registered recipe has a label and a description in both locales", () => {
    expect(DESIGN_THEME_ENTRIES.length, "注册表空了的话下面的循环是假绿").toBeGreaterThanOrEqual(4)
    for (const entry of DESIGN_THEME_ENTRIES) {
      for (const [locale, table] of [["en", en.settings], ["zh", zh.settings]] as const) {
        for (const key of [entry.labelKey, entry.descriptionKey] as const) {
          const value = dig(table as Table, keyPath(key))
          expect(typeof value, `${locale} 里缺 ${key}`).toBe("string")
          expect((value as string).length, `${locale} 的 ${key} 是空串`).toBeGreaterThan(3)
        }
      }
    }
    // 阳性对照：这把尺必须能报出「不存在」，否则上面那一片绿只是 dig() 恒返回同一个东西。
    expect(dig(en.settings as Table, keyPath("settings:designTheme.does-not-exist.label"))).toBeUndefined()
    expect(dig(zh.settings as Table, keyPath("settings:designTheme.does-not-exist.label"))).toBeUndefined()
  })

  test("every recipe that takes over has options the panel can actually render", () => {
    // 「能选到但一个控件都没有」= 装饰品。这里用「契约里有对应的 options 块」当代理判据，
    // 因为面板的分支条件就是 `config.id === <id>`；没有 options 块的配方不可能有分支。
    const withOptions: Record<string, keyof DesignThemeConfig> = { md3: "md3", mondrian: "mondrian", wuling: "wuling" }
    for (const entry of DESIGN_THEME_ENTRIES) {
      if (entry.id === "native") continue
      const field = withOptions[entry.id]
      expect(field, `配方 ${entry.id} 被注册了，但契约里没有它的 options 块（面板就没有可渲染的控件）`).toBeTruthy()
      expect(DEFAULT_DESIGN_THEME[field as keyof DesignThemeConfig], `DEFAULT_DESIGN_THEME 缺 ${String(field)}`).toBeTruthy()
    }
  })

  test("wuling's config survives the persistence boundary the same way the others do", () => {
    const stored = normalizeDesignThemeConfig({
      id: "wuling",
      dimensions: { ...ALL_DIMENSIONS_ON, geometry: false },
      wuling: { seed: "#B3261E", seedSource: "manual", cornerScale: 1.4, ledgerLabels: false },
    })
    expect(stored.id).toBe("wuling")
    expect(stored.wuling.seed).toBe("#b3261e")
    expect(stored.wuling.seedSource).toBe("manual")
    expect(stored.wuling.ledgerLabels).toBe(false)
    // 档位吸附：1.4 → 最近的合法档 1.5，而不是跳回默认 1。
    expect(stored.wuling.cornerScale).toBe(1.5)
    expect(WULING_CORNER_STEPS).toContain(stored.wuling.cornerScale)

    const garbage = normalizeDesignThemeConfig({ id: "wuling", wuling: { seed: "not-a-colour", cornerScale: "wide" } })
    expect(garbage.wuling.seed).toBe(DEFAULT_DESIGN_THEME.wuling.seed)
    expect(garbage.wuling.cornerScale).toBe(DEFAULT_DESIGN_THEME.wuling.cornerScale)

    // 未知 id 仍旧回 native——这条保证上面那个「被注册就必须有 options」的推论不会被绕过。
    expect(normalizeDesignThemeConfig({ id: "nope" }).id).toBe("native")
  })

  test("the default seed really is the preset's own primary (so defaults do not repaint)", () => {
    // 默认档位的颜色必须逐槽等于预设（浏览器尺里也有一条同样的等式，量的是计算值）。
    const resolution = resolveDesignTheme(
      { ...DEFAULT_DESIGN_THEME, id: "wuling" },
      { scheme: "light", activeThemeSeed: null, systemAccentAvailable: false },
    )
    expect(resolution, "武陵配方解析不出来").toBeTruthy()
    for (const [name, value] of Object.entries(WULING_PRESET_COLORS.light)) {
      expect(resolution?.bundle.vars[name], `${name} 默认值漂了`).toBe(value)
    }
    expect(resolution?.seedFallback, "activeTheme 在没有主题主色时必须如实报回落").toBe(true)
  })
})
