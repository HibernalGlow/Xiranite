import { ChevronUp } from "lucide-react"
import { lazy, Suspense, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react"

import { Button } from "@/components/ui/button"

import type { ReaderDirectoryNavigationDto, ReaderFolderEmptyAreaConfig } from "../../../../adapters/reader-http-client"

const FolderNavigationSettings = lazy(() => import("./FolderNavigationSettings"))

export function FolderNavigationSettingsControl({
  value,
  disabled,
  onChange,
}: {
  value: ReaderFolderEmptyAreaConfig
  disabled: boolean
  onChange(patch: Partial<ReaderFolderEmptyAreaConfig>): void
}) {
  return (
    <Suspense fallback={<span className="size-7 shrink-0" aria-hidden="true" />}>
      <FolderNavigationSettings value={value} disabled={disabled} onChange={onChange} />
    </Suspense>
  )
}

interface FolderNavigationState {
  canGoBack: boolean
  parentPath?: string
}

export function runFolderNavigation(
  action: "goUp" | "goBack" | "return",
  catalog: FolderNavigationState | undefined,
  navigate: (command: ReaderDirectoryNavigationDto) => void,
) {
  if ((action === "goBack" || action === "return") && catalog?.canGoBack) navigate({ action: "back" })
  else if ((action === "goUp" || action === "return") && catalog?.parentPath) navigate({ action: "up" })
}

export function useFolderEmptyAreaNavigation(value: ReaderFolderEmptyAreaConfig, onAction: (action: "goUp" | "goBack") => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const actionRef = useRef(onAction)
  actionRef.current = onAction

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [value.singleClickAction, value.doubleClickAction])

  function onClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!isDirectoryBlankArea(event.target)) return
    if (timerRef.current) clearTimeout(timerRef.current)
    const action = value.singleClickAction
    if (action === "none") return
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      actionRef.current(action)
    }, 220)
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!isDirectoryBlankArea(event.target)) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = undefined
    if (value.doubleClickAction !== "none") actionRef.current(value.doubleClickAction)
  }

  return { onClick, onDoubleClick }
}

function isDirectoryBlankArea(target: EventTarget): boolean {
  return target instanceof Element
    && !target.closest('[data-folder-entry="true"], [data-folder-return-footer="true"], [data-row-id], [data-index], button, input, select, textarea, a, [role="menu"]')
}

export interface FolderReturnFooterContext {
  disabled: boolean
  onReturn(): void
}

export function FolderReturnFooter({ context }: { context?: FolderReturnFooterContext }) {
  if (!context) return null
  return <div className="p-2" data-folder-return-footer="true"><ReturnButton {...context} /></div>
}

export function FolderDetailsReturnFooter({ disabled, onReturn, columnCount }: FolderReturnFooterContext & { columnCount: number }) {
  return <tr data-folder-return-footer="true"><td colSpan={columnCount} className="p-2"><ReturnButton disabled={disabled} onReturn={onReturn} /></td></tr>
}

function ReturnButton({ disabled, onReturn }: FolderReturnFooterContext) {
  return (
    <Button type="button" variant="outline" className="h-12 w-full border-dashed text-muted-foreground" disabled={disabled} onClick={onReturn}>
      <ChevronUp />
      返回上级目录
    </Button>
  )
}

export const FOLDER_LIST_COMPONENTS = { Footer: FolderReturnFooter }
export const FOLDER_GRID_COMPONENTS = { Footer: FolderReturnFooter }
export const EMPTY_VIRTUOSO_COMPONENTS = {}
