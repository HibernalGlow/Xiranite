/**
 * 高级主题注册表：id → 元数据 + 解析器。
 *
 * `native` 不是「没找到主题」的兜底分支，它是一条真实的注册项，语义是
 * 「本维度不接管，沿用颜色主题与既有组件样式」。把它写成数据而不是 if，
 * 是为了让第二个设计语言（如果以后真的要做）只能再加一条注册项，
 * 而不是在 apply/设置页各加一个分支。
 */

import type { DesignDimension } from "./contract"
import { DESIGN_DIMENSIONS, type DesignThemeConfig, type DesignThemeContext, type DesignThemeResolution, type AppDesignThemeId } from "./contract"
import { resolveMd3Theme } from "./md3/resolve"

export interface DesignThemeEntry {
  id: AppDesignThemeId
  /** i18n key（`settings:` 命名空间），同时喂选择器与搜索索引。 */
  labelKey: string
  descriptionKey: string
  /** 这个主题真的能接管的维度；不在列表里的维度，界面上就不该出现开关。 */
  ownsDimensions: readonly DesignDimension[]
}

const ALL: readonly DesignDimension[] = DESIGN_DIMENSIONS

export const DESIGN_THEME_ENTRIES: readonly DesignThemeEntry[] = [
  {
    id: "native",
    labelKey: "settings:designTheme.native.label",
    descriptionKey: "settings:designTheme.native.description",
    ownsDimensions: [],
  },
  {
    id: "md3",
    labelKey: "settings:designTheme.md3.label",
    descriptionKey: "settings:designTheme.md3.description",
    ownsDimensions: ALL,
  },
]

export function designThemeById(id: AppDesignThemeId): DesignThemeEntry | undefined {
  return DESIGN_THEME_ENTRIES.find((entry) => entry.id === id)
}

export function resolveDesignTheme(
  config: DesignThemeConfig,
  context: DesignThemeContext,
): DesignThemeResolution | null {
  switch (config.id) {
    case "md3":
      return resolveMd3Theme(config, context)
    case "native":
    default:
      // default 与 native 合并是刻意的：未知 id 在 normalize 阶段就回 native 了，
      // 走到这里只可能是调用方传了未注册的 id，此时必须是什么都不接管。
      return null
  }
}
