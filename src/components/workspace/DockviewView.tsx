import { useMemo, useCallback, useEffect, useRef } from "react"
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelHeaderProps } from "dockview-react"
import "dockview-react/dist/styles/dockview.css"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { getModule } from "@/components/modules/registry"
import { Plus, X, LayoutPanelTop } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * DockviewView — 真实接入 dockview-react。
 *
 * 数据模型：三种 viewMode 共享同一份 components，每个 viewMode 独立维护
 * hiddenIn.dockview 标志。
 *
 * dockview 同步策略（关键）：
 * - onReady 只在 dockview 挂载时触发一次，把 dockComponents 全部 addPanel
 * - 后续 dockComponents 变化（如关闭 tab）时，onReady 不会再触发，
 *   必须用 useEffect 主动同步 dockview API：
 *   · 对比 api.panels 和 dockComponents，删掉多的、加上少的
 *   · 这样切换 viewMode 回来时，被关闭的 tab 不会重新出现
 *
 * dockview-react 默认 className 是 `dockview-theme-abyss`，颜色写死不跟主题。
 * 外层容器加 `dv-theme-bridge` 类，CSS 通过 `.dv-theme-bridge .dockview-theme-abyss`
 * 选择器覆盖 abyss 变量，让其读取项目的 --card / --muted / --border。
 */
export function DockviewView() {
  const { visibleComponents } = useWorkspace()
  const dispatch = useWSDispatch()
  const apiRef = useRef<DockviewApi | null>(null)

  // 仅渲染未在 dockview 模式下隐藏的组件
  const dockComponents = useMemo(
    () => visibleComponents.filter(c => !c.hiddenIn?.dockview),
    [visibleComponents],
  )

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api: DockviewApi = event.api
    apiRef.current = api
    api.clear()
    dockComponents.forEach((comp, i) => {
      const mod = getModule(comp.moduleId)
      api.addPanel({
        id: comp.id,
        title: mod?.name ?? comp.moduleId,
        component: "module",
        params: { moduleId: comp.moduleId, compId: comp.id },
        position: { referencePanel: undefined, direction: i === 0 ? "within" : "right" },
      })
    })
  }, [dockComponents])

  // ⚠️ 关键修复：dockComponents 变化时主动同步 dockview API。
  // onReady 只在挂载时触发一次，关闭 tab 后 api 内部状态不会自动更新；
  // 切换 viewMode 回来时虽然 onReady 重新触发，但如果不主动同步，
  // dockview 会用旧 api 重新加 panel —— 关闭的 tab 又出现。
  // 这里对比 api.panels 和 dockComponents，删多补少。
  useEffect(() => {
    const api = apiRef.current
    if (!api) return

    const existingIds = new Set(api.panels.map(p => p.id))
    const wantedIds = new Set(dockComponents.map(c => c.id))

    // 删：api 有但 dockComponents 没有（被关闭的）
    for (const panel of api.panels) {
      if (!wantedIds.has(panel.id)) {
        api.removePanel(panel)
      }
    }

    // 加：dockComponents 有但 api 没有（新 deploy 的）
    dockComponents.forEach(comp => {
      if (!existingIds.has(comp.id)) {
        const mod = getModule(comp.moduleId)
        api.addPanel({
          id: comp.id,
          title: mod?.name ?? comp.moduleId,
          component: "module",
          params: { moduleId: comp.moduleId, compId: comp.id },
          position: { direction: "right" },
        })
      }
    })
  }, [dockComponents])

  // dockview 的 panel 组件映射
  const components = useMemo(() => ({
    module: (props: { params?: { moduleId?: string; compId?: string } }) => {
      const moduleId = props.params?.moduleId
      const compId = props.params?.compId
      if (!moduleId || !compId) return null
      return (
        <div className="h-full w-full">
          <ModuleRenderer moduleId={moduleId} compId={compId} />
        </div>
      )
    },
  }), [])

  // 自定义 tab header（带关闭按钮）— 关闭仅 toggle hiddenIn.dockview
  const tabComponents = useMemo(() => ({
    default: (props: IDockviewPanelHeaderProps) => {
      const title = String(props.api.title ?? "panel")
      return (
        <div className="flex items-center gap-2 px-1 group/tab">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="text-[10px] font-mono font-semibold tracking-widest uppercase">{title}</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch(actions.toggleComponentVisibility(props.api.id, "dockview"))
            }}
            className="grid h-4 w-4 place-items-center rounded opacity-0 group-hover/tab:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )
    },
  }), [dispatch])

  if (dockComponents.length === 0) {
    return (
      <div className="flex-1 ws-canvas-bg dv-theme-bridge flex items-center justify-center">
        <div className="text-center space-y-4">
          <LayoutPanelTop className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <p className="text-sm font-mono text-muted-foreground">// dock is empty</p>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-xs"
            onClick={() => dispatch(actions.setOverlay("registry"))}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            OPEN MODULE REGISTRY
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 ws-canvas-bg dv-theme-bridge flex flex-col overflow-hidden">
      <DockviewReact
        components={components}
        tabComponents={tabComponents}
        onReady={onReady}
        className="flex-1"
      />
    </div>
  )
}
