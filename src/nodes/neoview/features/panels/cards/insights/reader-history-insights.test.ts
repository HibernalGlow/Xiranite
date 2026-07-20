import { describe, expect, it } from "vitest"

import {
  buildDailyTrend,
  buildReadingHeatmap,
  buildReadingStreak,
  buildSourceBreakdown,
  localDayKey,
  startOfLocalDay,
} from "./reader-history-insights"

describe("reader-history-insights", () => {
  it("[neoview.insights.daily-trend] buckets the last 7 local days and compares with the previous week", () => {
    // Fixed local morning so weekday labels and day boundaries stay stable.
    const now = new Date(2026, 6, 20, 10, 0, 0).getTime() // Mon Jul 20 2026 local
    const day = (offset: number, hour = 12) => {
      const base = startOfLocalDay(now) - offset * 24 * 60 * 60 * 1_000
      return base + hour * 60 * 60 * 1_000
    }
    const events = [
      { updatedAt: day(0) },
      { updatedAt: day(0, 18) },
      { updatedAt: day(1) },
      { updatedAt: day(3) },
      { updatedAt: day(3, 15) },
      { updatedAt: day(3, 20) },
      { updatedAt: day(8) },
      { updatedAt: day(9) },
      { updatedAt: Number.NaN },
    ]

    const summary = buildDailyTrend(events, now)
    expect(summary.days).toHaveLength(7)
    expect(summary.days.map((entry) => entry.count)).toEqual([0, 0, 0, 3, 0, 1, 2])
    expect(summary.currentWeek).toBe(6)
    expect(summary.previousWeek).toBe(2)
    expect(summary.deltaPercent).toBe(200)
    expect(summary.maxCount).toBe(3)
    expect(summary.days.at(-1)?.label).toBe("一")
  })

  it("[neoview.insights.reading-streak] computes current/longest streaks on local day boundaries", () => {
    const now = new Date(2026, 6, 20, 9, 0, 0).getTime()
    const day = (offset: number) => startOfLocalDay(now) - offset * 24 * 60 * 60 * 1_000 + 8 * 60 * 60 * 1_000
    const events = [
      { updatedAt: day(0) },
      { updatedAt: day(1) },
      { updatedAt: day(2) },
      // gap
      { updatedAt: day(5) },
      { updatedAt: day(6) },
      { updatedAt: day(7) },
      { updatedAt: day(8) },
    ]

    const summary = buildReadingStreak(events, now)
    expect(summary.currentStreak).toBe(3)
    expect(summary.longestStreak).toBe(4)
    expect(summary.lastActiveDate).toBe(localDayKey(now))
    expect(summary.points.map((point) => point.value)).toEqual([1, 2, 3, 4, 1, 2, 3])
  })

  it("[neoview.insights.reading-streak] drops a broken streak when the last active day is older than yesterday", () => {
    const now = new Date(2026, 6, 20, 9, 0, 0).getTime()
    const day = (offset: number) => startOfLocalDay(now) - offset * 24 * 60 * 60 * 1_000 + 8 * 60 * 60 * 1_000
    const summary = buildReadingStreak([{ updatedAt: day(3) }, { updatedAt: day(4) }], now)
    expect(summary.currentStreak).toBe(0)
    expect(summary.longestStreak).toBe(2)
    expect(summary.lastActiveDate).toBe(localDayKey(day(3)))
  })

  it("[neoview.insights.heatmap] counts weekday/hour slots and reports the peak", () => {
    const mondayMorning = new Date(2026, 6, 20, 9, 15, 0).getTime() // Mon 09:15
    const mondayEvening = new Date(2026, 6, 20, 21, 0, 0).getTime()
    const sundayNight = new Date(2026, 6, 19, 21, 30, 0).getTime()
    const summary = buildReadingHeatmap([
      { updatedAt: mondayMorning },
      { updatedAt: mondayMorning },
      { updatedAt: mondayEvening },
      { updatedAt: sundayNight },
    ])
    expect(summary.maxCount).toBe(2)
    expect(summary.topSlot).toMatchObject({ weekday: 1, hour: 9, count: 2, weekdayLabel: "周一" })
    expect(summary.cells).toHaveLength(7 * 24)
  })

  it("[neoview.insights.source-breakdown] classifies archive/directory/media by kind and path", () => {
    const summary = buildSourceBreakdown([
      { updatedAt: 1, sourceKind: "archive", path: "D:/a.cbz" },
      { updatedAt: 2, sourceKind: "directory", path: "D:/series" },
      { updatedAt: 3, path: "D:/clip.mp4" },
      { updatedAt: 4, path: "D:/photo.jpg" },
      { updatedAt: 5, path: "D:/unknown.bin" },
      { updatedAt: 6, sourceKind: "archive", path: "D:/b.cbz" },
    ])
    expect(summary.total).toBe(6)
    expect(summary.items[0]).toEqual({ source: "压缩包", count: 2, percent: 33 })
    expect(summary.items.map((item) => item.source)).toEqual(["压缩包", "媒体", "其他", "图片", "文件夹"])
  })
})
