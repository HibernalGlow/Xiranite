import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react"
import { useTranslation } from "react-i18next"
import {
  HTMLContainer,
  DefaultStylePanel,
  Rectangle2d,
  ShapeUtil,
  Tldraw,
  createShapeId,
  defaultShapeUtils,
  useEditor,
  type TLBaseShape,
  type TLIndicatorPath,
  type TLResizeInfo,
  type TLUiStylePanelProps,
} from "tldraw"
import "tldraw/tldraw.css"
import { Palette, X } from "lucide-react"
import { AppleResizeHandle } from "@/components/ui/apple-resize-handle"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import { NodeSurfaceChrome, type NodeSurfaceChromeAction } from "@/components/workspace/NodeSurfaceChrome"
import { useTheme } from "@/components/theme-provider"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { useWorkspaceActions, useWorkspaceVisibleComponents } from "@/store/workspaceContext"
import type { ComponentInstance } from "@/types/workspace"
// Patched zh-cn translation including the 4 keys missing from tldraw's official CDN
// (action.copy-hovered-styles, action.frame-selection, page-menu.max-pages-reached,
//  page-menu.resize). Served locally to silence the "missing messages" dev warning.
import zhCnTranslationUrl from "@/assets/tldraw-zh-cn.json?url"

// assetUrls must be memoized or defined outside of any React component (per tldraw docs).
const tldrawAssetUrls = { translations: { "zh-cn": zhCnTranslationUrl } }

function resolveRootColor(cssValue: string, fallback: string) {
  if (typeof document === "undefined") return fallback

  const probe = document.createElement("span")
  probe.style.color = cssValue
  probe.style.position = "fixed"
  probe.style.pointerEvents = "none"
  probe.style.opacity = "0"
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || fallback
}

function syncTldrawThemeWithApp(editor: ReturnType<typeof useEditor>, signatureRef: { current: string }) {
  if (typeof editor.updateTheme !== "function" || typeof editor.getCurrentTheme !== "function") return

  const defaultTheme = "getTheme" in editor
    ? editor.getTheme("default") ?? editor.getCurrentTheme()
    : editor.getCurrentTheme()
  const selectionStroke = resolveRootColor("var(--primary)", "hsl(214, 84%, 56%)")
  const selectedContrast = resolveRootColor("var(--primary-foreground)", "#ffffff")
  const background = resolveRootColor("var(--background)", "#ffffff")
  const selectionFill = resolveRootColor(
    "color-mix(in oklch, var(--primary) 24%, transparent)",
    "rgba(68, 101, 233, 0.24)",
  )
  const signature = `${selectionStroke}|${selectionFill}|${selectedContrast}|${background}`
  if (signature === signatureRef.current) return
  signatureRef.current = signature

  editor.updateTheme({
    ...defaultTheme,
    colors: {
      light: {
        ...defaultTheme.colors.light,
        background,
        negativeSpace: background,
        selectionStroke,
        selectionFill,
        selectedContrast,
      },
      dark: {
        ...defaultTheme.colors.dark,
        background,
        negativeSpace: background,
        selectionStroke,
        selectionFill,
        selectedContrast,
      },
    },
  })
}

function useTldrawAppThemeBridge(editor: ReturnType<typeof useEditor>) {
  const signatureRef = useRef("")

  useEffect(() => {
    syncTldrawThemeWithApp(editor, signatureRef)

    const root = document.documentElement
    const observer = new MutationObserver(() => {
      syncTldrawThemeWithApp(editor, signatureRef)
    })
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style", "data-app-theme", "data-custom-theme", "data-custom-theme-name"],
    })
    return () => observer.disconnect()
  }, [editor])
}

function isFlowCanvasVisible(component: ComponentInstance) {
  return isComponentVisibleInView(component, "flow")
}

type ModuleShapeProps = {
  w: number
  h: number
  moduleId: string
  compId: string
}

type ModuleShape = TLBaseShape<"module", ModuleShapeProps>

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    module: ModuleShapeProps
  }
}

class ModuleShapeUtil extends ShapeUtil<ModuleShape> {
  static override type = "module" as const

  override getDefaultProps(): ModuleShape["props"] {
    return { w: 384, h: 320, moduleId: "", compId: "" }
  }

  override getGeometry(shape: ModuleShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      x: 0,
      y: 0,
      isFilled: true,
    })
  }

  override component(shape: ModuleShape) {
    return <ModuleShapeComponent shape={shape} />
  }

  override getIndicatorPath(shape: ModuleShape): TLIndicatorPath {
    const path = new Path2D()
    path.roundRect(0, 0, shape.props.w, shape.props.h, 6)
    return { path }
  }

  override canEdit() {
    return false
  }

  override isAspectRatioLocked() {
    return false
  }

  override canResize() {
    return true
  }

  override hideResizeHandles() {
    return true
  }

  override hideRotateHandle() {
    return true
  }

  override canBind() {
    return false
  }

  override onResize(shape: ModuleShape, info: TLResizeInfo<ModuleShape>): ModuleShape {
    const minW = 240
    const minH = 160
    const newW = Math.max(minW, info.initialBounds.width * info.scaleX)
    const newH = Math.max(minH, info.initialBounds.height * info.scaleY)
    return {
      ...shape,
      x: info.newPoint.x,
      y: info.newPoint.y,
      props: {
        ...shape.props,
        w: newW,
        h: newH,
      },
    }
  }
}

function ModuleShapeComponent({ shape }: { shape: ModuleShape }) {
  const editor = useEditor()
  const resizingRef = useRef(false)
  const workspaceActions = useWorkspaceActions()
  const { t, i18n } = useTranslation()
  const { moduleId, compId, w, h } = shape.props
  const mod = getModule(moduleId)
  const moduleName = i18n.exists(`module:${moduleId}.name`) ? t(`module:${moduleId}.name`) : (mod?.name ?? moduleId)

  const handleClose = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    workspaceActions.setComponentVisibility(compId, "flow", false)
  }
  const actions: NodeSurfaceChromeAction[] = [
    {
      key: "hide",
      label: t("common:hideIn", { view: t("topbar:viewMode.flow") }),
      icon: <X className="h-3 w-3" />,
      danger: true,
      onClick: handleClose,
    },
  ]
  const startResize = (target: HTMLDivElement, originX: number, originY: number, pointerId?: number) => {
    if (resizingRef.current) return
    resizingRef.current = true

    const startW = w
    const startH = h
    const zoom = typeof editor.getZoomLevel === "function" ? editor.getZoomLevel() : 1

    if (pointerId !== undefined) {
      try {
        target.setPointerCapture(pointerId)
      } catch {
        // Pointer capture can fail if the event was already released by the host browser.
      }
    }

    const onResizeMove = (moveEvent: globalThis.PointerEvent | globalThis.MouseEvent) => {
      const nextW = Math.max(240, startW + (moveEvent.clientX - originX) / zoom)
      const nextH = Math.max(160, startH + (moveEvent.clientY - originY) / zoom)
      editor.updateShape({
        id: shape.id,
        type: "module",
        props: {
          ...shape.props,
          w: nextW,
          h: nextH,
        },
      })
    }

    const stopResize = () => {
      resizingRef.current = false
      if (pointerId !== undefined) {
        try {
          target.releasePointerCapture(pointerId)
        } catch {
          // The browser may release capture before our cleanup path runs.
        }
      }
      window.removeEventListener("pointermove", onResizeMove)
      window.removeEventListener("mousemove", onResizeMove)
      window.removeEventListener("pointerup", stopResize)
      window.removeEventListener("pointercancel", stopResize)
      window.removeEventListener("mouseup", stopResize)
    }

    window.addEventListener("pointermove", onResizeMove)
    window.addEventListener("mousemove", onResizeMove)
    window.addEventListener("pointerup", stopResize, { once: true })
    window.addEventListener("pointercancel", stopResize, { once: true })
    window.addEventListener("mouseup", stopResize, { once: true })
  }

  const handleResizePointerStart = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.preventDefault()
    startResize(event.currentTarget, event.clientX, event.clientY, event.pointerId)
  }

  const handleResizeMouseStart = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    startResize(event.currentTarget, event.clientX, event.clientY)
  }

  return (
    <HTMLContainer
      data-component-id={compId}
      data-context-menu="flow-node"
      className="group relative flex flex-col overflow-visible rounded-md bg-card/72 text-card-foreground outline outline-1 outline-transparent shadow-[0_18px_50px_-36px_oklch(0_0_0/0.42)] backdrop-blur-md transition-[background-color,box-shadow,outline-color] hover:bg-card/82 hover:outline-border/35 hover:shadow-[0_22px_58px_-34px_oklch(0_0_0/0.5)]"
      style={{ width: w, height: h }}
    >
      <NodeSurfaceChrome actions={actions} moduleName={moduleName} version={mod?.version} />
      <div className="min-h-0 flex-1 overflow-hidden rounded-b-md pointer-events-auto">
        {moduleId && compId && (
          <ModuleRenderer moduleId={moduleId} compId={compId} />
        )}
      </div>
      <AppleResizeHandle
        interactive
        outside
        onMouseDown={handleResizeMouseStart}
        onPointerDown={handleResizePointerStart}
      />
    </HTMLContainer>
  )
}

function useSyncShapesFromStore(
  editor: ReturnType<typeof useEditor> | null,
  syncingShapeDeletesRef: { current: boolean },
) {
  const visibleComponents = useWorkspaceVisibleComponents()
  const workspaceActions = useWorkspaceActions()
  const lastSigRef = useRef<string>("")
  const hasSyncedRef = useRef(false)
  const previousDesiredIdsRef = useRef<Set<ModuleShape["id"]>>(new Set())

  useEffect(() => {
    if (!editor) return

    const flowComps = visibleComponents.filter(isFlowCanvasVisible)
    const desired = flowComps.map((comp, index) => ({
      id: createShapeId(comp.id),
      type: "module" as const,
      x: comp.flowPosition?.x ?? 100 + (index % 3) * 440,
      y: comp.flowPosition?.y ?? 100 + Math.floor(index / 3) * 380,
      props: {
        w: comp.flowSize?.width ?? 384,
        h: comp.flowSize?.height ?? 320,
        moduleId: comp.moduleId,
        compId: comp.id,
      },
    })) as ModuleShape[]

    const sig = JSON.stringify(desired)
    if (sig === lastSigRef.current) return
    lastSigRef.current = sig

    const current = editor.getCurrentPageShapes()
    const currentIds = new Set(current.map((shape) => shape.id))
    const desiredIds = new Set(desired.map((shape) => shape.id))
    const previousDesiredIds = previousDesiredIdsRef.current

    const toRemove = current.filter((shape) => !desiredIds.has(shape.id)).map((shape) => shape.id)
    if (toRemove.length) {
      syncingShapeDeletesRef.current = true
      try {
        editor.deleteShapes(toRemove)
      } finally {
        syncingShapeDeletesRef.current = false
      }
    }

    const missingDesired = desired.filter((shape) => !currentIds.has(shape.id))
    const missingPreviouslySynced = hasSyncedRef.current
      ? missingDesired.filter((shape) => previousDesiredIds.has(shape.id))
      : []
    const toCreate = missingDesired.filter((shape) => !hasSyncedRef.current || !previousDesiredIds.has(shape.id))
    const toUpdate = desired.filter((shape) => currentIds.has(shape.id))

    for (const shape of missingPreviouslySynced) {
      const compId = shape.props.compId
      if (compId) workspaceActions.setComponentVisibility(compId, "flow", false)
    }

    if (toCreate.length) editor.createShapes(toCreate)
    if (toUpdate.length) editor.updateShapes(toUpdate)

    previousDesiredIdsRef.current = desiredIds
    hasSyncedRef.current = true
  }, [editor, syncingShapeDeletesRef, visibleComponents, workspaceActions])
}

function useSyncChangesToStore(editor: ReturnType<typeof useEditor> | null) {
  const workspaceActions = useWorkspaceActions()

  useEffect(() => {
    if (!editor) return
    return editor.sideEffects.registerAfterChangeHandler(
      "shape",
      (prev, next) => {
        if (next.type !== "module") return
        const shape = next as ModuleShape
        const { compId, w, h } = shape.props
        if (!compId) return

        if (prev?.x !== next.x || prev?.y !== next.y) {
          workspaceActions.setComponentFlowPos(compId, next.x, next.y)
        }
        if (prev?.type === "module") {
          const previousShape = prev as ModuleShape
          if (previousShape.props.w !== w || previousShape.props.h !== h) {
            workspaceActions.setComponentFlowSize(compId, w, h)
          }
        }
      },
    )
  }, [editor, workspaceActions])
}

function useSyncDeletedShapesToStore(
  editor: ReturnType<typeof useEditor> | null,
  syncingShapeDeletesRef: { current: boolean },
) {
  const workspaceActions = useWorkspaceActions()

  useEffect(() => {
    if (!editor) return
    return editor.sideEffects.registerAfterDeleteHandler(
      "shape",
      (deleted) => {
        if (syncingShapeDeletesRef.current) return
        if (deleted.type !== "module") return

        const compId = (deleted as ModuleShape).props.compId
        if (!compId) return

        workspaceActions.setComponentVisibility(compId, "flow", false)
      },
    )
  }, [editor, syncingShapeDeletesRef, workspaceActions])
}

const customShapeUtils = [...defaultShapeUtils, ModuleShapeUtil]

function FlowCanvas() {
  const editor = useEditor()
  const syncingShapeDeletesRef = useRef(false)

  useTldrawAppThemeBridge(editor)
  useSyncShapesFromStore(editor, syncingShapeDeletesRef)
  useSyncChangesToStore(editor)
  useSyncDeletedShapesToStore(editor, syncingShapeDeletesRef)

  return null
}

function CollapsibleStylePanel(props: TLUiStylePanelProps) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        className="xiranite-tldraw-style-panel-toggle"
        aria-label="展开画布调色盘"
        title="展开画布调色盘"
        onClick={() => setOpen(true)}
      >
        <Palette className="h-4 w-4" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="xiranite-tldraw-style-panel">
      <button
        type="button"
        className="xiranite-tldraw-style-panel-toggle xiranite-tldraw-style-panel-toggle--open"
        aria-label="收起画布调色盘"
        title="收起画布调色盘"
        onClick={() => setOpen(false)}
      >
        <Palette className="h-4 w-4" aria-hidden="true" />
      </button>
      <DefaultStylePanel {...props} />
    </div>
  )
}

export function FlowCanvasView() {
  const { theme } = useTheme()

  return (
    <Tldraw
      shapeUtils={customShapeUtils}
      colorScheme={theme}
      assetUrls={tldrawAssetUrls}
      options={{ maxPages: 1 }}
      components={{ PageMenu: () => null, MainMenu: () => null, StylePanel: CollapsibleStylePanel }}
    >
      <FlowCanvas />
    </Tldraw>
  )
}
