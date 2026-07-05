import { useWorkspace } from "@/store/workspaceContext"
import { WorkspaceSidebar } from "./WorkspaceSidebar"
import { TopBar } from "./TopBar"
import { WorkspaceCanvas } from "./WorkspaceCanvas"
import { ModuleRegistry } from "@/components/views/ModuleRegistry"
import { ThemeSettings } from "@/components/views/ThemeSettings"
import { DeploymentHub } from "@/components/views/DeploymentHub"
import { cn } from "@/lib/utils"

export function WorkspaceLayout() {
  const { state } = useWorkspace()

  const themeClass = state.theme === "endfield" ? "theme-endfield" : state.theme === "wuling" ? "theme-wuling" : ""

  return (
    <div className={cn("flex flex-col h-screen overflow-hidden bg-background text-foreground", themeClass)}>
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        <WorkspaceSidebar />

        <main className="flex-1 flex flex-col overflow-hidden">
          {state.sidebarView === "workspaces" && <WorkspaceCanvas />}
          {state.sidebarView === "registry" && <ModuleRegistry />}
          {state.sidebarView === "settings" && <ThemeSettings />}
          {state.sidebarView === "deployment" && <DeploymentHub />}
        </main>
      </div>
    </div>
  )
}
