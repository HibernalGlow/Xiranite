import type { ComponentInstance } from "@/types/workspace"

import { packMosaicFiller, type MosaicTile } from "./mosaicFiller"

export const MASONRY_MAX_WIDTH = 1680
export const MASONRY_MIN_WIDTH = 360
export const MASONRY_GAP = 16
export const MASONRY_MAX_COLUMNS = 4
export const MASONRY_HORIZONTAL_PADDING = 32
export const MASONRY_COLLAPSED_HEIGHT = 40
const MASONRY_DEFAULT_HEIGHT = 420
export const MASONRY_FOCUSED_HEIGHT = 680
export const MASONRY_MIN_HEIGHT = 240
export const MASONRY_MAX_HEIGHT = 860
/** 补位格子的行单位高（列单位高 = 列宽）。84 + 间距 = 100px 一档，够细以免卡片下沿浪费大片空白。 */
export const MASONRY_CELL_HEIGHT = 84
/** 最长列下方额外预留的行数——瀑布流的纵向空间靠它一路往下长，而不是停在最后一张卡。 */
export const MASONRY_FILLER_ROWS = 10

export interface MasonrySlot {
  x: number
  y: number
  w: number
  h: number
}

export interface MasonryPlacement extends MasonrySlot {
  comp: ComponentInstance
  index: number
}

export interface MasonryFillerTile extends MasonrySlot {
  col: number
  row: number
  footprint: string
  /** 动画类序号；共边格子必不相同 */
  anim: number
}

/**
 * 确定性「最短列」瀑布流布局。列宽 = (容器内宽 − 列间距) / 列数；每张卡放进当前最矮的列，
 * 宽度填满列、高度用卡片自己的持久化高度（不随列宽等比缩放）。卡片高度是已知量，所以
 * 不需要虚拟化库、也不需要 ResizeObserver 量 DOM——纯函数、可单测。
 *
 * 卡片之外的剩余空间（列与列之间的参差下沿 + 最长列下方 `MASONRY_FILLER_ROWS` 行）交给
 * `packMosaicFiller` 用变尺寸格子补位：把每张卡按 100px 的行格子投影到格子上并标成 blocked，
 * 补位块只填空格 ⇒ 结构与卡片不重叠，且总高度随内容向下延长（纵向不留白边）。
 */
export function computeMasonryLayout(
  components: ComponentInstance[],
  containerWidth: number,
  focusedComponentId: string | null,
): { placements: MasonryPlacement[]; filler: MasonryFillerTile[]; totalHeight: number } {
  const columns = getMasonryColumnCount(containerWidth)
  const inner = Math.max(0, Math.min(MASONRY_MAX_WIDTH, containerWidth) - MASONRY_HORIZONTAL_PADDING)
  const colW = columns > 0 ? (inner - MASONRY_GAP * (columns - 1)) / columns : inner
  const heights = new Array<number>(columns).fill(0)
  const rowPitch = MASONRY_CELL_HEIGHT + MASONRY_GAP

  // 放进最矮列并推进该列高度，返回该槽的坐标。
  const place = (h: number): MasonrySlot => {
    const column = heights.indexOf(Math.min(...heights))
    const slot: MasonrySlot = {
      x: Math.round(column * (colW + MASONRY_GAP)),
      y: Math.round(heights[column]),
      w: Math.round(colW),
      h,
    }
    heights[column] = slot.y + h + MASONRY_GAP
    return slot
  }

  const placements: MasonryPlacement[] = components.map((comp, index) => ({
    comp,
    index,
    ...place(masonryCardHeight(comp, focusedComponentId)),
  }))

  const usedHeight = heights.length ? Math.max(...heights) : 0
  const rows = Math.ceil(usedHeight / rowPitch) + MASONRY_FILLER_ROWS
  const blocked: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(columns).fill(false))
  for (const p of placements) {
    const firstRow = Math.floor(p.y / rowPitch)
    const lastRow = Math.ceil((p.y + p.h) / rowPitch) - 1
    const column = Math.round(p.x / (colW + MASONRY_GAP))
    for (let row = Math.max(0, firstRow); row <= Math.min(rows - 1, lastRow); row++) {
      blocked[row][column] = true
    }
  }

  const filler: MasonryFillerTile[] = packMosaicFiller(columns, rows, blocked).map((tile: MosaicTile) => ({
    col: tile.col,
    row: tile.row,
    footprint: tile.footprint,
    anim: tile.anim,
    x: Math.round(tile.col * (colW + MASONRY_GAP)),
    y: Math.round(tile.row * rowPitch),
    w: Math.round(tile.colSpan * colW + (tile.colSpan - 1) * MASONRY_GAP),
    h: Math.round(tile.rowSpan * MASONRY_CELL_HEIGHT + (tile.rowSpan - 1) * MASONRY_GAP),
  }))

  return { placements, filler, totalHeight: rows * rowPitch }
}

/** 卡的实际像素高：折叠卡固定矮条；否则用卡片堆叠视图共用的持久化高度 `laneSize`。
 *
 * 不读 `size` / `flowSize` / `bentoLayout`：`size` 是被删掉的自由布局的遗留字段（每个组件创建时
 * 都带 340×280，早先把它当瀑布流高度用，于是所有卡都是 280 高——用户报的「默认都蛮小的」就是这条），
 * `flowSize` 属于 React Flow，`bentoLayout` 属于 GridStack 拼盘，各自都是别的视图的几何。 */
function masonryCardHeight(comp: ComponentInstance, focusedComponentId: string | null): number {
  if (comp.collapsed) return MASONRY_COLLAPSED_HEIGHT
  const persisted = comp.laneSize?.height
  if (persisted) return clampNumber(persisted, MASONRY_MIN_HEIGHT, MASONRY_MAX_HEIGHT)
  return focusedComponentId === comp.id ? MASONRY_FOCUSED_HEIGHT : MASONRY_DEFAULT_HEIGHT
}

export function getMasonryColumnCount(width: number): number {
  const availableWidth = Math.max(0, Math.min(MASONRY_MAX_WIDTH, width) - MASONRY_HORIZONTAL_PADDING)
  if (availableWidth <= 0) return 1
  return clampNumber(
    Math.floor((availableWidth + MASONRY_GAP) / (MASONRY_MIN_WIDTH + MASONRY_GAP)),
    1,
    MASONRY_MAX_COLUMNS,
  )
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
