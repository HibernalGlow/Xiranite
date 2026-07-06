/**
 * FlowView —— TLDraw 白板版本。
 *
 * 替代原 @xyflow/react 实现。
 * - 每个可见组件 = 一个 custom shape（type: "module"）
 * - shape 内部渲染 ModuleRenderer
 * - shape 位置/大小变化同步回 store.flowPosition / flowSize
 */
import { useEffect, useRef } from "react"
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
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import { isComponentVisibleInView } from "@/lib/componentVisibility"
import { useTheme } from "@/components/theme-provider"
import { Plus, Workflow, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ComponentInstance } from "@/types/workspace"

function isFlowCanvasVisible(component: ComponentInstance) {
  return isComponentVisibleInView(component, "flow")
}

// ── 自定义 shape 类型（通过 module augmentation 注册到 TLShape union） ────────
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

// ── ModuleShapeUtil：继承 ShapeUtil（不依赖 TLBaseBoxShape union） ─────────────
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

  override canEdit() { return false }
  override isAspectRatioLocked() { return false }
  override canResize() { return true }
  override canBind() { return false }

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

// ── Shape 内部组件（用 hook 拿 dispatch） ────────────────────────────────────
function ModuleShapeComponent({ shape }: { shape: ModuleShape }) {
  const dispatch = useWSDispatch()
  const { t, i18n } = useTranslation()
  const { moduleId, compId, w, h } = shape.props
  const mod = getModule(moduleId)
  const moduleName = i18n.exists(`module:${moduleId}.name`) ? t(`module:${moduleId}.name`) : (mod?.name ?? moduleId)

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    dispatch(actions.setComponentVisibility(compId, "flow", false))
  }

  return (
    <HTMLContainer
      className="relative overflow-hidden rounded-md border border-border bg-card shadow-[0_8px_24px_-8px_oklch(0_0_0/0.35)] flex flex-col"
      style={{ width: w, height: h }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex h-8 items-center gap-2 border-b border-border/60 bg-muted/30 px-2 flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        <span className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase truncate flex-1">
          {moduleName}
        </span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title={t("common:hideIn", { view: t("topbar:viewMode.flow") })}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden pointer-events-none">
        {moduleId && compId && (
          <ModuleRenderer moduleId={moduleId} compId={compId} />
        )}
      </div>
    </HTMLContainer>
  )
}

// ── store → tldraw：把 visibleComponents 同步成 shapes ───────────────────────
function useSyncShapesFromStore(editor: ReturnType<typeof useEditor> | null) {
  const { visibleComponents } = useWorkspace()
  const lastSigRef = useRef<string>("")

  useEffect(() => {
    if (!editor) return

    const flowComps = visibleComponents.filter(isFlowCanvasVisible)
    const desired = flowComps.map((comp, i) => ({
      id: createShapeId(comp.id),
      type: "module" as const,
      x: comp.flowPosition?.x ?? 100 + (i % 3) * 440,
      y: comp.flowPosition?.y ?? 100 + Math.floor(i / 3) * 380,
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
    const currentIds = new Set(current.map(s => s.id))
    const desiredIds = new Set(desired.map(s => s.id))

    // 删除不再需要的 shapes
    const toRemove = current.filter(s => !desiredIds.has(s.id)).map(s => s.id)
    if (toRemove.length) editor.deleteShapes(toRemove)

    // 区分新建 vs 更新
    const toCreate = desired.filter(s => !currentIds.has(s.id))
    const toUpdate = desired.filter(s => currentIds.has(s.id))
    if (toCreate.length) editor.createShapes(toCreate)
    if (toUpdate.length) editor.updateShapes(toUpdate)
  }, [editor, visibleComponents])
}

// ── tldraw → store：把 shape 变化同步回 store ────────────────────────────────
function useSyncChangesToStore(editor: ReturnType<typeof useEditor> | null) {
  const dispatch = useWSDispatch()

  useEffect(() => {
    if (!editor) return
    const unsub = editor.sideEffects.registerAfterChangeHandler(
      "shape",
      (prev, next) => {
        if (next.type !== "module") return
        const shape = next as ModuleShape
        const { compId, w, h } = shape.props
        if (!compId) return

        if (prev?.x !== next.x || prev?.y !== next.y) {
          dispatch(actions.setComponentFlowPos(compId, next.x, next.y))
        }
        if (prev?.type === "module") {
          const p = prev as ModuleShape
          if (p.props.w !== w || p.props.h !== h) {
            dispatch(actions.setComponentFlowSize(compId, w, h))
          }
        }
      },
    )
    return unsub
  }, [editor, dispatch])
}

// ── 主组件 ───────────────────────────────────────────────────────────────────
const customShapeUtils = [...defaultShapeUtils, ModuleShapeUtil]

function FlowCanvas() {
  const editor = useEditor()
  const { visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()

  useSyncShapesFromStore(editor)
  useSyncChangesToStore(editor)

  const { t } = useTranslation()
  const isEmpty = visibleComponents.filter(isFlowCanvasVisible).length === 0

  if (isEmpty) {
    return (
      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
        <div className="text-center space-y-4 pointer-events-auto">
          <Workflow className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm font-mono text-muted-foreground">{t("view:flow.empty")}</p>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={() => dispatch(actions.setOverlay("registry"))}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t("view:flow.openRegistry")}
          </Button>
        </div>
      </div>
    )
  }
  return null
}

export function FlowView() {
  const { theme } = useTheme()
  return (
    <div className="flex-1 min-h-0 w-full ws-canvas-bg relative">
      <Tldraw
        shapeUtils={customShapeUtils}
        colorScheme={theme}
        options={{ maxPages: 1 }}
        components={{ PageMenu: () => null, MainMenu: () => null }}
      >
        <FlowCanvas />
      </Tldraw>
    </div>
  )
}
