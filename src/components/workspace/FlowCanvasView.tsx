import { useEffect, useRef, type MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  Tldraw,
  createShapeId,
  defaultShapeUtils,
  useEditor,
  type TLBaseShape,
  type TLIndicatorPath,
  type TLResizeInfo,
} from "tldraw"
import "tldraw/tldraw.css"
import { X } from "lucide-react"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import { useTheme } from "@/components/theme-provider"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { useWorkspaceActions, useWorkspaceVisibleComponents } from "@/store/workspaceContext"
import type { ComponentInstance } from "@/types/workspace"

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

  return (
    <HTMLContainer
      data-component-id={compId}
      className="relative flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-[0_8px_24px_-8px_oklch(0_0_0/0.35)]"
      style={{ width: w, height: h }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="xiranite-ui-copy flex h-8 flex-shrink-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-2">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="flex-1 truncate text-[10px] font-mono font-semibold uppercase tracking-widest text-muted-foreground">
          {moduleName}
        </span>
        <button
          onPointerDown={(event) => event.stopPropagation()}
          onClick={handleClose}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title={t("common:hideIn", { view: t("topbar:viewMode.flow") })}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden pointer-events-auto">
        {moduleId && compId && (
          <ModuleRenderer moduleId={moduleId} compId={compId} />
        )}
      </div>
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

  useSyncShapesFromStore(editor, syncingShapeDeletesRef)
  useSyncChangesToStore(editor)
  useSyncDeletedShapesToStore(editor, syncingShapeDeletesRef)

  return null
}

export function FlowCanvasView() {
  const { theme } = useTheme()

  return (
    <Tldraw
      shapeUtils={customShapeUtils}
      colorScheme={theme}
      options={{ maxPages: 1 }}
      components={{ PageMenu: () => null, MainMenu: () => null }}
    >
      <FlowCanvas />
    </Tldraw>
  )
}
