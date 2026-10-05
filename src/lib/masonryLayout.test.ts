import { describe, expect, test } from "vitest"

import {
  computeMasonryLayout,
  getMasonryColumnCount,
  MASONRY_CELL_HEIGHT,
  MASONRY_COLLAPSED_HEIGHT,
  MASONRY_FILLER_ROWS,
  MASONRY_GAP,
  MASONRY_HORIZONTAL_PADDING,
  MASONRY_MAX_HEIGHT,
  MASONRY_MAX_WIDTH,
  MASONRY_MIN_HEIGHT,
} from "./masonryLayout"
import type { ComponentInstance } from "@/types/workspace"

// 纯布局数学：只读 id / collapsed / size 等，构造最小夹具即可。
function card(id: string, extra: Partial<ComponentInstance> = {}): ComponentInstance {
  return { id, moduleId: `m-${id}`, ...extra } as ComponentInstance
}

// 1200px 容器 → 3 列；列宽 = (min(1680,1200) - 32 - 16*2) / 3 = 378.67 → 379
describe("computeMasonryLayout", () => {
  test("应用卡片用持久化高度，不随列宽等比缩放（修掉竖向截断）", () => {
    // 一张持久化 800×600 的卡，被放进 ~379px 宽的列：高度必须仍是 600，
    // 而不是旧逻辑那样按 600*(列宽/800) 缩到 ~285 → 内容截断。
    const { placements } = computeMasonryLayout([card("a", { laneSize: { height: 600 } })], 1200, null)
    expect(placements[0].h).toBe(600)
    expect(placements[0].w).toBeLessThan(800) // 宽度确实收窄到列宽
  })

  test("持久化高度仍受上下限夹住", () => {
    const tiny = computeMasonryLayout([card("t", { laneSize: { height: 50 } })], 1200, null)
    const huge = computeMasonryLayout([card("h", { laneSize: { height: 999999 } })], 1200, null)
    expect(tiny.placements[0].h).toBe(MASONRY_MIN_HEIGHT)
    expect(huge.placements[0].h).toBe(MASONRY_MAX_HEIGHT)
  })

  test("折叠卡固定矮条", () => {
    const { placements } = computeMasonryLayout([card("c", { collapsed: true })], 1200, null)
    expect(placements[0].h).toBe(MASONRY_COLLAPSED_HEIGHT)
  })

  test("最短列分配：第 4 张进最矮的列，而不是按行铺", () => {
    // 3 列。前 3 张各占一列；给 col0 一张很高的卡，第 4 张应落到 col1/col2（更矮），不是 col0。
    const cards = [
      card("tall", { laneSize: { height: 800 } }), // → col0, y=0
      card("b", { laneSize: { height: 240 } }), //    → col1
      card("c", { laneSize: { height: 240 } }), //    → col2
      card("d", { laneSize: { height: 240 } }), //    → 最矮列（col1，与 col2 同高时取先出现的最矮）
    ]
    const { placements } = computeMasonryLayout(cards, 1200, null)
    const byId = Object.fromEntries(placements.map(p => [p.comp.id, p]))
    expect(byId.tall.x).toBe(0) // col0
    // d 不能落在 tall 那一列（col0）——否则说明没走最短列
    expect(byId.d.x).not.toBe(byId.tall.x)
  })

  test("列内不重叠、列间不重叠", () => {
    const cards = Array.from({ length: 9 }, (_, i) => card(`k${i}`, { laneSize: { height: 300 } }))
    const { placements, totalHeight } = computeMasonryLayout(cards, 1200, null)
    const cols = getMasonryColumnCount(1200)

    // 按列分组，验证同列内下一张的 y ≥ 上一张 y+h+gap
    const byColumn = new Map<number, typeof placements>()
    for (const p of placements) {
      const arr = byColumn.get(p.x) ?? []
      arr.push(p)
      byColumn.set(p.x, arr)
    }
    for (const arr of byColumn.values()) {
      arr.sort((a, b) => a.y - b.y)
      for (let i = 1; i < arr.length; i++) {
        expect(arr[i].y).toBeGreaterThanOrEqual(arr[i - 1].y + arr[i - 1].h + MASONRY_GAP)
      }
    }
    // 列数 = 不同 x 的个数
    expect(byColumn.size).toBe(cols)
    expect(totalHeight).toBeGreaterThan(300)
  })

  test("空列表 → 卡片为零，但补位格子仍铺满预留带（空版面不是一片死白）", () => {
    const { placements, filler, totalHeight } = computeMasonryLayout([], 1200, null)
    expect(placements).toEqual([])
    expect(filler.length).toBeGreaterThan(0)
    expect(totalHeight).toBe(MASONRY_FILLER_ROWS * (MASONRY_CELL_HEIGHT + MASONRY_GAP))
  })

  test("补位格子纵向延长画布：总高 = 最长列（含下间距）向上取整 + 预留行", () => {
    const cols = getMasonryColumnCount(1200)
    const { placements, filler, totalHeight } = computeMasonryLayout([card("a", { laneSize: { height: 400 } })], 1200, null)
    const rowPitch = MASONRY_CELL_HEIGHT + MASONRY_GAP
    const tallest = Math.max(...placements.map((p) => p.y + p.h + MASONRY_GAP))
    const rows = Math.ceil(totalHeight / rowPitch)
    expect(rows).toBe(Math.ceil(tallest / rowPitch) + MASONRY_FILLER_ROWS)
    // 剩余空间真的被补满了：3 列 × 15 行里，卡片占掉一部分格子，其余都是补位块
    expect(filler.length).toBeGreaterThan(1)
    expect(filler.length).toBeLessThan(cols * rows)
  })

  test("补位格子不与卡片重叠、互不重叠、且不出列网格", () => {
    const cards = Array.from({ length: 5}, (_, i) => card(`k${i}`, { laneSize: { height: 240 + i * 90 } }))
    const { placements, filler } = computeMasonryLayout(cards, 1200, null)
    const inner = Math.min(MASONRY_MAX_WIDTH, 1200) - MASONRY_HORIZONTAL_PADDING

    const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

    for (const f of filler) {
      expect(f.x + f.w).toBeLessThanOrEqual(inner + 1) // 落在列网格内（+1 容 rounding）
      expect(placements.some((p) => hit(f, p))).toBe(false)
    }
    for (let i = 0; i < filler.length; i++) {
      for (let j = i + 1; j < filler.length; j++) {
        expect(hit(filler[i], filler[j])).toBe(false)
      }
    }
  })

  test("补位是变尺寸而不是清一色方块，且共边块不同动画", () => {
    const { filler } = computeMasonryLayout([card("a", { laneSize: { height: 300 } })], 1200, null)
    expect(new Set(filler.map((f) => f.footprint)).size).toBeGreaterThan(1)
    expect(new Set(filler.map((f) => f.anim)).size).toBeGreaterThan(1)
    // 同一格子起点唯一（说明补位是按空格走的，不是随机撒点）
    const starts = filler.map((f) => `${f.col},${f.row}`)
    expect(new Set(starts).size).toBe(starts.length)
  })

  test("反证：若把高度改成按列宽缩放，持久化高度用例会红（证明这条尺看得见那个 bug）", () => {
    const colW = (1200 - 32 - MASONRY_GAP * 2) / 3
    const aspectScaled = Math.round(colW * (600 / 800)) // 旧 bug 的算法
    expect(aspectScaled).toBeLessThan(600) // 旧算法会竖向截断
    const { placements } = computeMasonryLayout([card("a", { laneSize: { height: 600 } })], 1200, null)
    expect(placements[0].h).not.toBe(aspectScaled) // 新实现不等于旧 bug 值
  })

  test("遗留自由布局的 size 不再决定瀑布流高度（「默认都蛮小的」的根因）", () => {
    // 每个组件创建时都自带 size:{w:340,h:280}（自由布局遗留字段）。旧实现把它排在第一位读，
    // 于是无论用户在哪个视图调过多高，瀑布流里每张卡都恒为 280。
    const both = card("b", { size: { w: 340, h: 280 }, laneSize: { height: 620 } })
    expect(computeMasonryLayout([both], 1200, null).placements[0].h).toBe(620)
    // 只有遗留 size、没调过高度的卡走默认高 420，而不是 280
    const legacyOnly = card("l", { size: { w: 340, h: 280 } })
    expect(computeMasonryLayout([legacyOnly], 1200, null).placements[0].h).toBe(420)
  })
})
