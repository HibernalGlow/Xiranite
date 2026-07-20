/**
 * Pure history insight aggregations shared by insight cards.
 * Input is a bounded recent-history window from ReaderLibrary (`listRecent`).
 */

export interface HistoryInsightEvent {
  updatedAt: number
  path?: string
  sourceKind?: string
}

export interface DailyTrendDay {
  key: string
  label: string
  count: number
}

export interface DailyTrendSummary {
  days: readonly DailyTrendDay[]
  currentWeek: number
  previousWeek: number
  deltaPercent: number
  maxCount: number
}

export interface ReadingStreakPoint {
  date: string
  label: string
  value: number
}

export interface ReadingStreakSummary {
  points: readonly ReadingStreakPoint[]
  currentStreak: number
  longestStreak: number
  lastActiveDate: string | null
  maxValue: number
}

export interface ReadingHeatmapCell {
  weekday: number
  hour: number
  count: number
  weekdayLabel: string
  hourLabel: string
}

export interface ReadingHeatmapSummary {
  cells: readonly ReadingHeatmapCell[]
  maxCount: number
  topSlot: ReadingHeatmapCell | null
}

export interface SourceBreakdownItem {
  source: string
  count: number
  percent: number
}

export interface SourceBreakdownSummary {
  total: number
  items: readonly SourceBreakdownItem[]
}

const DAY_MS = 24 * 60 * 60 * 1_000
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const
const WEEKDAY_FULL_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const

export function localDayKey(timestamp: number, now = new Date(timestamp)): string | null {
  if (!Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  // `now` is unused for keying but kept for call-site clarity/testability of clock ownership.
  void now
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function buildDailyTrend(
  events: readonly HistoryInsightEvent[],
  nowMs = Date.now(),
): DailyTrendSummary {
  const today = startOfLocalDay(nowMs)
  const counts = new Map<string, number>()
  for (const event of events) {
    const key = localDayKey(event.updatedAt)
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const days: DailyTrendDay[] = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const dayMs = today - offset * DAY_MS
    const date = new Date(dayMs)
    const key = localDayKey(dayMs)!
    days.push({
      key,
      label: WEEKDAY_LABELS[date.getDay()] ?? "?",
      count: counts.get(key) ?? 0,
    })
  }

  let previousWeek = 0
  for (let offset = 7; offset < 14; offset += 1) {
    const key = localDayKey(today - offset * DAY_MS)!
    previousWeek += counts.get(key) ?? 0
  }

  const currentWeek = days.reduce((sum, day) => sum + day.count, 0)
  const deltaPercent = previousWeek > 0
    ? Math.round(((currentWeek - previousWeek) / previousWeek) * 100)
    : currentWeek > 0
      ? 100
      : 0
  const maxCount = Math.max(...days.map((day) => day.count), 1)
  return { days, currentWeek, previousWeek, deltaPercent, maxCount }
}

export function buildReadingStreak(
  events: readonly HistoryInsightEvent[],
  nowMs = Date.now(),
): ReadingStreakSummary {
  const uniqueDays = new Set<string>()
  for (const event of events) {
    const key = localDayKey(event.updatedAt)
    if (key) uniqueDays.add(key)
  }

  const sortedDays = [...uniqueDays]
    .map((key) => ({ key, time: Date.parse(`${key}T00:00:00`) }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => left.time - right.time)

  let running = 0
  let longestStreak = 0
  let lastTime: number | null = null
  const points: ReadingStreakPoint[] = []

  for (const { key, time } of sortedDays) {
    if (lastTime !== null && time - lastTime <= DAY_MS) running += 1
    else running = 1
    lastTime = time
    if (running > longestStreak) longestStreak = running
    const date = new Date(time)
    points.push({
      date: key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      value: running,
    })
  }

  const todayKey = localDayKey(nowMs)!
  const yesterdayKey = localDayKey(nowMs - DAY_MS)!
  const lastActiveDate = sortedDays.length ? sortedDays[sortedDays.length - 1]!.key : null
  let currentStreak = 0
  if (lastActiveDate === todayKey || lastActiveDate === yesterdayKey) {
    currentStreak = points.at(-1)?.value ?? 0
  }

  return {
    points,
    currentStreak,
    longestStreak,
    lastActiveDate,
    maxValue: Math.max(longestStreak, 1),
  }
}

export function buildReadingHeatmap(
  events: readonly HistoryInsightEvent[],
): ReadingHeatmapSummary {
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const event of events) {
    if (!Number.isFinite(event.updatedAt)) continue
    const date = new Date(event.updatedAt)
    if (Number.isNaN(date.getTime())) continue
    matrix[date.getDay()]![date.getHours()]! += 1
  }

  let maxCount = 0
  let topSlot: ReadingHeatmapCell | null = null
  const cells: ReadingHeatmapCell[] = []
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const count = matrix[weekday]![hour]!
      if (count > maxCount) maxCount = count
      const cell: ReadingHeatmapCell = {
        weekday,
        hour,
        count,
        weekdayLabel: WEEKDAY_FULL_LABELS[weekday] ?? "?",
        hourLabel: `${String(hour).padStart(2, "0")}:00`,
      }
      cells.push(cell)
      if (!topSlot || cell.count > topSlot.count) topSlot = cell
    }
  }
  return { cells, maxCount, topSlot: topSlot && topSlot.count > 0 ? topSlot : null }
}

export function buildSourceBreakdown(
  events: readonly HistoryInsightEvent[],
): SourceBreakdownSummary {
  const counts = new Map<string, number>()
  for (const event of events) {
    const source = classifyHistorySource(event)
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  const total = events.length
  const items = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .map(([source, count]) => ({
      source,
      count,
      percent: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
  return { total, items }
}

export function classifyHistorySource(event: HistoryInsightEvent): string {
  const kind = event.sourceKind?.toLocaleLowerCase("en-US")
  if (kind === "directory") return "文件夹"
  if (kind === "archive") return "压缩包"
  if (kind === "document") return "文档"
  if (kind === "media") return "媒体"
  if (kind === "image") return "图片"
  const path = (event.path ?? "").replaceAll("\\", "/").toLocaleLowerCase("en-US")
  if (/\.(zip|cbz|cbr|rar|7z|cb7)(?:$|[/?#])/u.test(path)) return "压缩包"
  if (/\.pdf(?:$|[/?#])/u.test(path)) return "文档"
  if (/\.(mp4|webm|mkv|avi|mov)(?:$|[/?#])/u.test(path)) return "媒体"
  if (/\.(jpe?g|png|webp|gif|avif|jxl|bmp)(?:$|[/?#])/u.test(path)) return "图片"
  if (path.includes("/") && !/\.[a-z0-9]+$/u.test(path.split("/").at(-1) ?? "")) return "文件夹"
  return "其他"
}
