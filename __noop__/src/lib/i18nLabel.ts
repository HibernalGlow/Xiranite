import type { TFunction } from "i18next"

const LANE_N_RE = /^LANE\s+(\d+)$/
const WORKSPACE_N_RE = /^common:workspaceN:(\d+)$/

/**
 * 翻译可能为 i18n key 的 label。
 *
 * - 形如 "common:workspaceN:123" 的 key → t("common:workspaceN", { n: 123 })
 * - 形如 "ns:key" 的 i18n key → t(key) 翻译
 * - 形如 "LANE 1" 的默认泳道名 → t("view:lane.laneN", { n })
 * - 用户自定义文本 → 原样返回
 */
export function translateLabel(label: string, t: TFunction): string {
  if (!label) return label
  // common:workspaceN:123 格式（带数字参数的 i18n key）
  const wsMatch = label.match(WORKSPACE_N_RE)
  if (wsMatch) {
    return t("common:workspaceN", { n: Number(wsMatch[1]) })
  }
  // 形如 "ns:key" 的 i18n key（无空格）
  if (label.includes(":") && !label.includes(" ")) {
    return t(label)
  }
  // "LANE N" 格式
  const laneMatch = label.match(LANE_N_RE)
  if (laneMatch) {
    return t("view:lane.laneN", { n: Number(laneMatch[1]) })
  }
  return label
}
