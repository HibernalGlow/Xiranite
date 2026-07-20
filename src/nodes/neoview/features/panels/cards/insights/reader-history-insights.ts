/**
 * Pure history insight aggregations shared by DailyTrend and ReadingStreak cards.
 * Input is a bounded recent-history window from ReaderLibrary (`listRecent`).
 */

export interface HistoryInsightEvent {
  updatedAt: number
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

const DAY_MS = 24 * 60 * 60 * 1_000
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const

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
