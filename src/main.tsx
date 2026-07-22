/**
 * Xiranite 桌面/WebView 应用入口（React 19 + Vite）。
 *
 * 启动顺序：i18n → 后端配置 hydrate → 挂载 React 树。
 * i18n 必须先于 React 渲染完成，确保首屏文案命中正确语言；
 * 后端配置 hydrate 异步执行，失败仅记录日志，不阻塞渲染。
 */
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { NuqsAdapter } from "nuqs/adapters/react"

import "./styles/tailwind.css"
import "./index.css"
import "./styles/themes/index.css"
import { initI18n } from "@/i18n"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { hydrateLocalBackendConfig } from "@/backend/localBackendConfig"
import { startupDebug, startupDebugAsync } from "@/lib/startupDebug"

/**
 * 全局 React Query 客户端。
 *
 * - `staleTime: Infinity` —— 数据由后端/TOML 推送，前端不主动过期；
 * - `refetchOnWindowFocus: false` —— 桌面应用窗口聚焦频繁，避免无谓重取；
 * - `retry: false` —— 失败交给调用方处理，防止后台重试风暴。
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false },
  },
})

void bootstrap()

/**
 * 应用启动协程。
 *
 * 步骤：
 *  1. 初始化 i18n（加载默认语言资源）；
 *  2. 异步 hydrate 后端配置（失败仅记日志，不阻塞 UI）；
 *  3. 在 #root 上挂载 React 树，层级为：
 *     StrictMode → QueryClientProvider → NuqsAdapter → ThemeProvider → App。
 */
async function bootstrap() {
  startupDebug("bootstrap:begin")
  await startupDebugAsync("bootstrap:i18n", initI18n)

  void startupDebugAsync("bootstrap:backend-config", hydrateLocalBackendConfig).catch((error) => {
    console.error("[backend] initial config hydrate failed:", error)
  })

  startupDebug("bootstrap:react-render:begin")
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
  requestAnimationFrame(() => {
    startupDebug("bootstrap:first-animation-frame")
  })
}
