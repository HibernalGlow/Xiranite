import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ThemeProvider } from "@/components/theme-provider"
import { hydrateLocalBackendConfig } from "@/backend/localBackendConfig"
import { initI18n } from "@/i18n"
import { ExternalNodeLaunchHost } from "@/external-node-host/ExternalNodeLaunchHost"
import "./styles/tailwind.css"
import "./index.css"
import "./styles/themes/index.css"

await initI18n()
void hydrateLocalBackendConfig()

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
})

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <ExternalNodeLaunchHost />
    </ThemeProvider>
  </QueryClientProvider>,
)
