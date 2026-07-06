import type { TFunction } from "i18next"

const LANE_N_RE = /^LANE\s+(\d+)$/

/**
 * 翻译可能为 i18n key 的 label。
 *
 * - 形如 "ns:key" 的 i18n key → t(key) 翻译
 * - 形如 "LANE 1" 的默认泳道名 → t("view:lane.laneN", { n })
 * - 用户自定义文本 → 原样返回
 */
export function translateLabel(label: string, t: TFunction): string {
  if (!label) return label
  if (label.includes(":") && !label.includes(" ")) {
    return t(label)
  }
  const m = label.match(LANE_N_RE)
  if (m) {
    return t("view:lane.laneN", { n: Number(m[1]) })
  }
  return label
}
