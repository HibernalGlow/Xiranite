/**
 * 高级主题的落盘端：把解析出来的 token 写成 `:root` inline 变量 + 根属性。
 *
 * 三个不能出错的地方：
 *  1. **清理必须精确**。变量写 inline（优先级高于任何选择器），所以「关掉高级主题」
 *     不能靠再写一遍旧值，只能撤我们自己写过的那批 key；`appliedKeys` 只记我们写过的。
 *  2. **顺序是语义**。自定义主题（themes.json 的 cssVars）写同一个 inline key
 *     （例如 `--primary`），后写的赢。挂载顺序因此固定：
 *     WorkspaceAppearance（颜色主题）→ WorkspaceDesignTheme（高级主题）。
 *     我们撤掉自己的值之后，颜色主题那批必须有人重写回来，
 *     所以这里交给调用方的 `restoreAppearance`，而不是假装 DOM 还是对的。
 *  3. **要能回读**。`data-design-rev` 与 `data-design-applied-vars` 是 DOM 侧证据：
 *     「代码跑过了」与「画面上真的换了」只有靠这两个才分得开，浏览器测试也断言它们。
 */

import {
  DESIGN_APPLIED_ATTR,
  DESIGN_CONTRAST_ATTR,
  DESIGN_DIM_ATTR_PREFIX,
  DESIGN_DIMENSIONS,
  DESIGN_REV_ATTR,
  DESIGN_ROOT_ATTR,
  DESIGN_SEED_ATTR,
  DESIGN_SEED_FALLBACK_ATTR,
  DESIGN_SEED_SOURCE_ATTR,
  DESIGN_VARIANT_ATTR,
  type DesignThemeConfig,
  type DesignThemeContext,
} from "./contract"
import { resolveDesignTheme } from "./registry"

export interface DesignThemeReadback {
  id: DesignThemeConfig["id"]
  rev: number
  appliedVars: number
  seed: string | null
  seedSource: string | null
  seedFallback: boolean | null
  contrastLevel: number | null
  variant: string | null
}

const appliedKeys = new Set<string>()
let rev = 0
let lastReadback: DesignThemeReadback = {
  id: "native",
  rev: 0,
  appliedVars: 0,
  seed: null,
  seedSource: null,
  seedFallback: null,
  contrastLevel: null,
  variant: null,
}

function removeAppliedVars(root: HTMLElement) {
  for (const key of appliedKeys) root.style.removeProperty(key)
  appliedKeys.clear()
}

/**
 * 应用（或重应用）高级主题。
 *
 * @param restoreAppearance 撤掉我们接管的颜色变量后，把颜色主题的 inline 变量重写回来。
 */
export function applyDesignTheme(
  config: DesignThemeConfig,
  context: DesignThemeContext,
  restoreAppearance?: () => void,
): void {
  const root = document.documentElement
  const resolution = resolveDesignTheme(config, context)

  // 先撤旧的再写新的：变量集合会随维度/variant 变化，留下上一轮的 key 就是脏值。
  const hadVars = appliedKeys.size > 0
  removeAppliedVars(root)
  if (hadVars) restoreAppearance?.()

  for (const [name, value] of Object.entries(resolution?.bundle.attributes ?? {})) {
    root.setAttribute(name, value)
  }

  const vars = resolution?.bundle.vars ?? {}
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value)
    appliedKeys.add(name)
  }

  rev += 1
  root.setAttribute(DESIGN_ROOT_ATTR, config.id)
  for (const dimension of DESIGN_DIMENSIONS) {
    root.setAttribute(`${DESIGN_DIM_ATTR_PREFIX}${dimension}`, config.dimensions[dimension] ? "on" : "off")
  }
  root.setAttribute(DESIGN_REV_ATTR, String(rev))
  root.setAttribute(DESIGN_APPLIED_ATTR, String(appliedKeys.size))

  if (config.id === "md3" && resolution) {
    root.setAttribute(DESIGN_VARIANT_ATTR, config.md3.variant)
    root.setAttribute(DESIGN_SEED_ATTR, resolution.seed)
    root.setAttribute(DESIGN_SEED_SOURCE_ATTR, resolution.seedSource)
    root.setAttribute(DESIGN_SEED_FALLBACK_ATTR, resolution.seedFallback ? "true" : "false")
    root.setAttribute(DESIGN_CONTRAST_ATTR, String(config.md3.contrastLevel))
  } else {
    root.removeAttribute(DESIGN_VARIANT_ATTR)
    root.removeAttribute(DESIGN_SEED_ATTR)
    root.removeAttribute(DESIGN_SEED_SOURCE_ATTR)
    root.removeAttribute(DESIGN_SEED_FALLBACK_ATTR)
    root.removeAttribute(DESIGN_CONTRAST_ATTR)
  }

  lastReadback = {
    id: config.id,
    rev,
    appliedVars: appliedKeys.size,
    seed: resolution?.seed ?? null,
    seedSource: resolution?.seedSource ?? null,
    seedFallback: resolution?.seedFallback ?? null,
    contrastLevel: config.id === "md3" ? config.md3.contrastLevel : null,
    variant: config.id === "md3" ? config.md3.variant : null,
  }
}

/** 卸载/切换到完全不干预的状态时用。 */
export function clearDesignTheme(restoreAppearance?: () => void) {
  const root = document.documentElement
  removeAppliedVars(root)
  root.removeAttribute(DESIGN_ROOT_ATTR)
  for (const dimension of DESIGN_DIMENSIONS) root.removeAttribute(`${DESIGN_DIM_ATTR_PREFIX}${dimension}`)
  root.removeAttribute(DESIGN_REV_ATTR)
  root.removeAttribute(DESIGN_APPLIED_ATTR)
  root.removeAttribute(DESIGN_VARIANT_ATTR)
  root.removeAttribute(DESIGN_SEED_ATTR)
  root.removeAttribute(DESIGN_SEED_SOURCE_ATTR)
  root.removeAttribute(DESIGN_SEED_FALLBACK_ATTR)
  root.removeAttribute(DESIGN_CONTRAST_ATTR)
  restoreAppearance?.()
}

/** 仅供测试与诊断：DOM 才是事实源，这份快照只是它的镜像。 */
export function getDesignThemeReadback(): DesignThemeReadback {
  return lastReadback
}
