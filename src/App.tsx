import { lazy, Suspense } from "react"
import { WorkspaceProvider } from "@/store/workspaceContext"
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout"
import { parseAsString, useQueryStates } from "nuqs"

const FloatingComponentWindow = lazy(() =>
  import("@/components/workspace/FloatingComponentWindow").then((module) => ({
    default: module.FloatingComponentWindow,
  })),
)

const floatingWindowParsers = {
  floatingComponent: parseAsString,
  windowId: parseAsString,
  moduleId: parseAsString,
  title: parseAsString,
}

export function App() {
  const [params] = useQueryStates(floatingWindowParsers)

  return (
    <WorkspaceProvider>
      {params.floatingComponent ? (
        <Suspense fallback={<div className="h-screen bg-background" />}>
          <FloatingComponentWindow
            compId={params.floatingComponent}
            windowId={params.windowId}
            moduleIdFallback={params.moduleId}
            titleFallback={params.title}
          />
        </Suspense>
      ) : (
        <WorkspaceLayout />
      )}
    </WorkspaceProvider>
  )
}

export default App
