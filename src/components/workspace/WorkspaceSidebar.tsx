import { useState } from "react"
import { cn } from "@/lib/utils"
import { useWorkspace, useWSDispatch, actions } from "@/store/workspaceContext"
import {
  Plus, X,
  Archive, Network, Cpu, BarChart3, Layers,
  Zap, AlertTriangle, Pencil,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TooltipProvider } from "@/components/ui/tooltip"

const WS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "ws-alpha": Layers,
  "ws-grid":  BarChart3,
  "ws-kern":  Cpu,
  "ws-net":   Network,
  "ws-arch":  Archive,
}

export function WorkspaceSidebar() {
  const { state } = useWorkspace()
  const dispatch = useWSDispatch()
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [tabDraft, setTabDraft] = useState("")
  const [editingWsId, setEditingWsId] = useState<string | null>(null)
  const [wsDraft, setWsDraft] = useState("")

  function startEditTab(wsId: string, tabId: string, currentLabel: string) {
    setEditingTabId(`${wsId}::${tabId}`)
    setTabDraft(currentLabel)
  }

  function commitEditTab(wsId: string, tabId: string) {
    if (tabDraft.trim()) dispatch(actions.renameTab(wsId, tabId, tabDraft.trim().toUpperCase()))
    setEditingTabId(null)
  }

  function startEditWs(wsId: string, label: string) {
    setEditingWsId(wsId)
    setWsDraft(label)
  }

  function commitEditWs(wsId: string) {
    if (wsDraft.trim()) dispatch({ type: "RENAME_WORKSPACE", id: wsId, label: wsDraft.trim().toUpperCase() })
    setEditingWsId(null)
  }

  return (
    <TooltipProvider delayDuration={300}>
    <aside className="w-56 bg-sidebar border-r border-sidebar-border flex flex-col h-full select-none">
        {/* ── User Profile ── */}
        <div className="px-3 py-3 border-b border-sidebar-border flex items-center gap-2">
          <div className="w-8 h-8 rounded-sm bg-primary/15 border border-primary/30 flex items-center justify-center overflow-hidden flex-shrink-0">
            <img
              src="/images/AP1WRLvshv4nlPBl6aRZZfGYMND5CAh8yAZ95K2KcoQYLTSWy9D-sEfixRCznEuUs1CsS5dVNaqd5MrTkq8di-8jybVA6_4ZunFzhfUcoV7MQ8I8FNLH1S_RjOVDJVxisq5upAYoR3lSTX84aPRdTVz3zS5DqUrlV-u9vp6EXQmxTvz473TultUc7_YuXmwSE0X6hZmd2YkeXGuA_G7T3sj36ol0dskhLJfG4eM6mizz9nVc124Zmc4TLz_JyjU=s2560"
              alt="operator"
              className="w-full h-full object-cover opacity-80"
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-mono font-semibold text-sidebar-foreground truncate">OPERATOR_01</p>
            <p className="text-[9px] font-mono text-muted-foreground truncate">SYS_VER_4.0_STABLE</p>
          </div>
        </div>

        {/* ── Workspace List ── */}
        <div className="flex-1 overflow-y-auto py-2">
          {state.workspaces.map(ws => {
            const Icon = WS_ICONS[ws.id] ?? Layers
            const isActive = ws.id === state.activeWorkspaceId

            return (
              <div key={ws.id} className={cn("group/ws", isActive && "bg-sidebar-accent/40")}>
                {/* Workspace row */}
                <div
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-sidebar-accent/30 transition-colors",
                    isActive && "border-l-2 border-sidebar-primary"
                  )}
                  onClick={() => { dispatch(actions.setActiveWorkspace(ws.id)); dispatch(actions.setSidebarView("workspaces")) }}
                >
                  <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", isActive ? "text-sidebar-primary" : "text-muted-foreground")} />

                  {editingWsId === ws.id ? (
                    <Input
                      value={wsDraft}
                      autoFocus
                      onChange={e => setWsDraft(e.target.value)}
                      onBlur={() => commitEditWs(ws.id)}
                      onKeyDown={e => { if (e.key === "Enter") commitEditWs(ws.id); if (e.key === "Escape") setEditingWsId(null) }}
                      className="h-5 text-[10px] font-mono uppercase py-0 px-1 bg-background/60"
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className={cn("text-[11px] font-mono flex-1 truncate", isActive ? "text-sidebar-foreground font-medium" : "text-muted-foreground")}>
                      {ws.label}
                    </span>
                  )}

                  <div className="flex items-center gap-0.5 opacity-0 group-hover/ws:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); startEditWs(ws.id, ws.label) }}
                      className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); dispatch(actions.removeWorkspace(ws.id)) }}
                      className="p-0.5 rounded text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>

                {/* Arc-style tabs for active workspace */}
                {isActive && (
                  <div className="ml-6 pr-2 py-1 space-y-0.5">
                    {ws.tabs.map(tab => {
                      const isActiveTab = tab.id === ws.activeTabId
                      const editKey = `${ws.id}::${tab.id}`
                      return (
                        <div
                          key={tab.id}
                          className={cn(
                            "group/tab flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer transition-colors tab-slide-in",
                            isActiveTab
                              ? "bg-sidebar-primary/15 text-sidebar-primary"
                              : "text-muted-foreground hover:bg-sidebar-accent/40 hover:text-sidebar-foreground"
                          )}
                          onClick={e => { e.stopPropagation(); dispatch(actions.setActiveTab(ws.id, tab.id)) }}
                        >
                          <div className={cn("w-1 h-1 rounded-full flex-shrink-0", isActiveTab ? "bg-sidebar-primary" : "bg-muted-foreground/40")} />

                          {editingTabId === editKey ? (
                            <Input
                              value={tabDraft}
                              autoFocus
                              onChange={e => setTabDraft(e.target.value)}
                              onBlur={() => commitEditTab(ws.id, tab.id)}
                              onKeyDown={e => { if (e.key === "Enter") commitEditTab(ws.id, tab.id); if (e.key === "Escape") setEditingTabId(null) }}
                              className="h-4 text-[10px] font-mono uppercase py-0 px-1 bg-background/60"
                              onClick={e => e.stopPropagation()}
                            />
                          ) : (
                            <span className="text-[10px] font-mono flex-1 truncate">{tab.label}</span>
                          )}

                          <div className="flex items-center gap-0.5 opacity-0 group-hover/tab:opacity-100 transition-opacity">
                            <button
                              onClick={e => { e.stopPropagation(); startEditTab(ws.id, tab.id, tab.label) }}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-2 w-2" />
                            </button>
                            {ws.tabs.length > 1 && (
                              <button
                                onClick={e => { e.stopPropagation(); dispatch(actions.removeTab(ws.id, tab.id)) }}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <X className="h-2 w-2" />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Add tab button */}
                    <button
                      onClick={e => { e.stopPropagation(); dispatch(actions.addTab(ws.id)) }}
                      className="flex items-center gap-1.5 px-2 py-0.5 w-full text-muted-foreground/50 hover:text-muted-foreground transition-colors rounded-sm hover:bg-sidebar-accent/20"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      <span className="text-[10px] font-mono">NEW TAB</span>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Deploy Button ── */}
        <div className="px-3 py-2 border-t border-sidebar-border">
          <Button
            className="w-full font-mono text-xs h-8 btn-primary-glow"
            onClick={() => dispatch(actions.setSidebarView("registry"))}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            DEPLOY NEW MODULE
          </Button>
          <Button
            variant="ghost"
            className="w-full font-mono text-xs h-7 mt-1 text-muted-foreground"
            onClick={() => dispatch(actions.addWorkspace())}
          >
            <Plus className="h-3 w-3 mr-1.5" />
            NEW WORKSPACE
          </Button>
        </div>

        {/* ── Footer: Status & Alerts ── */}
        <div className="px-3 py-2 border-t border-sidebar-border space-y-1">
          <button
            onClick={() => dispatch(actions.setSidebarView("deployment"))}
            className="flex items-center gap-2 w-full text-muted-foreground hover:text-foreground transition-colors py-0.5"
          >
            <Zap className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-mono">STATUS</span>
          </button>
          <button
            className="flex items-center gap-2 w-full text-muted-foreground hover:text-foreground transition-colors py-0.5"
          >
            <AlertTriangle className="h-3 w-3 text-chart-3" />
            <span className="text-[10px] font-mono">ALERTS</span>
            <span className="ml-auto text-[9px] font-mono bg-chart-3/20 text-chart-3 px-1 rounded">2</span>
          </button>
        </div>
      </aside>
    </TooltipProvider>
  )
}