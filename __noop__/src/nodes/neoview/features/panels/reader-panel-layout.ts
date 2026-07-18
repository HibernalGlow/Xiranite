import type { ReaderBoardLayoutPatch, ReaderShellConfigDto } from "../../adapters/reader-http-client"
import { PANEL_DEFINITIONS, type ReaderPanelSide } from "./registry"

export interface ReaderPanelMove {
  shell: ReaderShellConfigDto
  patch: ReaderBoardLayoutPatch
}

export function moveReaderPanel(
  shell: ReaderShellConfigDto,
  panelId: string,
  destination: ReaderPanelSide,
  destinationIndex: number,
): ReaderPanelMove | undefined {
  const definition = PANEL_DEFINITIONS.find((panel) => panel.id === panelId)
  if (definition && !definition.canMove) return undefined

  const current = effectivePanelLayout(shell, panelId)
  if (!current || !current.visible) return undefined

  const sourceIds = readerPanelIdsForSide(shell, current.position === "left" || current.position === "right" ? current.position : destination)
  const destinationIds = current.position === destination
    ? sourceIds.filter((id) => id !== panelId)
    : readerPanelIdsForSide(shell, destination).filter((id) => id !== panelId)
  const insertionIndex = clamp(destinationIndex, 0, destinationIds.length)
  destinationIds.splice(insertionIndex, 0, panelId)

  if (current.position === destination && arraysEqual(sourceIds, destinationIds)) return undefined

  const nextPanelLayout = { ...shell.panelLayout }
  if (current.position === "left" || current.position === "right") {
    const remainingSourceIds = sourceIds.filter((id) => id !== panelId)
    for (const [order, id] of remainingSourceIds.entries()) {
      nextPanelLayout[id] = { ...effectivePanelLayout(shell, id)!, order }
    }
  }
  for (const [order, id] of destinationIds.entries()) {
    nextPanelLayout[id] = { ...effectivePanelLayout(shell, id)!, visible: true, position: destination, order }
  }

  const nextShell = { ...shell, panelLayout: nextPanelLayout }
  return { shell: nextShell, patch: createReaderPanelBoardPatch(nextShell) }
}

export function readerPanelIdsForSide(shell: ReaderShellConfigDto, side: ReaderPanelSide): string[] {
  const ids = new Set<string>([
    ...PANEL_DEFINITIONS.map((panel) => panel.id),
    ...Object.keys(shell.panelLayout),
  ])
  return [...ids]
    .filter((id) => {
      const layout = effectivePanelLayout(shell, id)
      return layout?.visible && layout.position === side
    })
    .sort((left, right) => {
      const leftLayout = effectivePanelLayout(shell, left)!
      const rightLayout = effectivePanelLayout(shell, right)!
      return leftLayout.order - rightLayout.order || left.localeCompare(right)
    })
}

export function createReaderPanelBoardPatch(shell: ReaderShellConfigDto): ReaderBoardLayoutPatch {
  const panelIds = new Set<string>([
    ...PANEL_DEFINITIONS.map((panel) => panel.id),
    ...Object.keys(shell.panelLayout),
  ])
  return {
    expectedRevision: shell.revision ?? 0,
    board: {
      panels: [...panelIds].map((id) => ({ id, ...effectivePanelLayout(shell, id)! })),
      cards: Object.entries(shell.cardLayout).map(([cardId, card]) => ({
        cardId,
        panelId: card.panelId,
        visible: card.visible,
        order: card.order,
      })),
    },
  }
}

function effectivePanelLayout(shell: ReaderShellConfigDto, panelId: string): ReaderShellConfigDto["panelLayout"][string] | undefined {
  const current = shell.panelLayout[panelId]
  if (current) return current
  const definition = PANEL_DEFINITIONS.find((panel) => panel.id === panelId)
  if (!definition) return undefined
  return {
    visible: definition.defaultVisible,
    order: definition.defaultOrder,
    position: definition.defaultSide,
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
