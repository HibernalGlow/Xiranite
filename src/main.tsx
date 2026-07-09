import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { NuqsAdapter } from "nuqs/adapters/react"

import "./index.css"
import "./styles/themes/index.css"
import { initI18n } from "@/i18n"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { hydrateLocalBackendConfig } from "@/backend/localBackendConfig"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false },
  },
})

void bootstrap()

async function bootstrap() {
  await initI18n()

  void hydrateLocalBackendConfig().catch((error) => {
    console.error("[backend] initial config hydrate failed:", error)
  })

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </StrictMode>
  )
}
