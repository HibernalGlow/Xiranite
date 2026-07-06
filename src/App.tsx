import { WorkspaceProvider } from "@/store/workspaceContext"
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout"
import { FloatingComponentWindow } from "@/components/workspace/FloatingComponentWindow"

export function App() {
  const params = new URLSearchParams(window.location.search)
  const floatingComponent = params.get("floatingComponent")

  return (
    <WorkspaceProvider>
      {floatingComponent ? (
        <FloatingComponentWindow
          compId={floatingComponent}
          windowId={params.get("windowId")}
          moduleIdFallback={params.get("moduleId")}
          titleFallback={params.get("title")}
        />
      ) : (
        <WorkspaceLayout />
      )}
    </WorkspaceProvider>
  )
}

export default App
