import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme-provider"
import { hydrateLocalBackendConfig } from "@/backend/localBackendConfig"
import { initI18n } from "@/i18n"
import { StandaloneNodeApp } from "@/node-app/StandaloneNodeApp"
import "./styles/tailwind.css"
import "./index.css"
import "./styles/themes/index.css"

const nodeId = import.meta.env.VITE_XIRANITE_NODE_APP_ID
if (!nodeId) throw new Error("VITE_XIRANITE_NODE_APP_ID is required for a node application build.")
const snapshotId = import.meta.env.VITE_XIRANITE_NODE_APP_SNAPSHOT_ID
if (!snapshotId) throw new Error("VITE_XIRANITE_NODE_APP_SNAPSHOT_ID is required for a node application build.")

await initI18n()
void hydrateLocalBackendConfig()

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
})

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <StandaloneNodeApp nodeId={nodeId} snapshotId={snapshotId} />
    </ThemeProvider>
  </QueryClientProvider>,
)
