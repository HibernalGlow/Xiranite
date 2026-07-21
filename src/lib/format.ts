/**
 * 日期格式化工具。
 *
 * 基于 Intl.DateTimeFormat 实现，默认 en-US 区域与 long month + numeric day +
 * numeric year 格式。解析失败时返回空字符串而非抛错，便于 UI 安全使用。
 */
export function formatDate(
  date: Date | string | number | undefined,
  opts: Intl.DateTimeFormatOptions = {},
) {
  if (!date) return "";

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: opts.month ?? "long",
      day: opts.day ?? "numeric",
      year: opts.year ?? "numeric",
      ...opts,
    }).format(new Date(date));
  } catch (_err) {
    return "";
  }
}
