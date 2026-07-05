/**
 * Lane 模式的拖拽状态 — React 版本，模块级单例。
 *
 * 从 Xlchemy 项目移植（src/state/dragState.ts），把 Svelte 的响应式 state
 * 改成普通对象 + 订阅列表，让 React 组件可以订阅变化。
 *
 * 两种拖拽模式：
 * - lane: 拖整条 lane 重排
 * - card: 拖 card 跨 lane 移动
 */

export type DragMode = "none" | "lane" | "card"

interface DragState {
  mode: DragMode
  laneId: string | null
  cardId: string | null
  fromLaneId: string | null
  targetCardId: string | null
  insertAfter: boolean
}

const state: DragState = {
  mode: "none",
  laneId: null,
  cardId: null,
  fromLaneId: null,
  targetCardId: null,
  insertAfter: false,
}

const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setLaneDrag(id: string): void {
  state.mode = "lane"
  state.laneId = id
  state.cardId = null
  state.fromLaneId = null
  emit()
}

export function setCardDrag(cardId: string, fromLaneId: string): void {
  state.mode = "card"
  state.cardId = cardId
  state.fromLaneId = fromLaneId
  state.laneId = null
  state.targetCardId = null
  state.insertAfter = false
  emit()
}

export function setCardDropTarget(targetCardId: string | null, insertAfter: boolean): void {
  state.targetCardId = targetCardId
  state.insertAfter = insertAfter
  emit()
}

export function clearDrag(): void {
  state.mode = "none"
  state.laneId = null
  state.cardId = null
  state.fromLaneId = null
  state.targetCardId = null
  state.insertAfter = false
  emit()
}

export function getDragMode(): DragMode {
  return state.mode
}

export function getDragState(): Readonly<DragState> {
  return state
}
