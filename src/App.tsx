import { WorkspaceProvider } from "@/store/workspaceContext"
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout"

export function App() {
  return (
    <WorkspaceProvider>
      <WorkspaceLayout />
    </WorkspaceProvider>
  )
}

export default App
