/**
 * Xiranite 桌面/WebView 应用入口（React 19 + Vite）。
 *
 * 启动顺序：i18n → 后端配置 hydrate → 挂载 React 树。
 * i18n 必须先于 React 渲染完成，确保首屏文案命中正确语言；
 * 后端配置 hydrate 在渲染前完成，避免首屏消费者读取到尚未注入的配置。
 */
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { NuqsAdapter } from "nuqs/adapters/react"

import "./styles/tailwind.css"
import "./index.css"
import "./styles/themes/index.css"
// 设计语言（高级主题）的组件层必须排在颜色主题之后：同特异性时靠顺序决胜。
import "./styles/design/md3-components.css"
import "./styles/design/md3-settings-nav.css"
// 第二份配方：风格派（De Stijl）。与 MD3 层互斥，靠 data-app-design 选择。
import "./styles/design/stijl-components.css"
import { initI18n } from "@/i18n"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { ApplicationErrorBoundary } from "@/components/ApplicationErrorBoundary"
import { hydrateLocalBackendConfig } from "@/backend/localBackendConfig"
import { installNativeWindowDragRegion } from "@/backend/windowDragRegion"
import { attachNodeOperationStoreMirror } from "@/store/nodeOperationStoreBridge"
import { activateInstalledFrontendPlugins } from "@/plugins/pluginRegistry"
import { startupDebug, startupDebugAsync } from "@/lib/startupDebug"
import { createLogger } from "@/lib/logger"

const logger = createLogger("bootstrap")

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
 *  3. 挂上操作日志镜像：传输层只发布 NodeOperationUpdate，应用级 nodeOperations store 由壳层订阅写入；
 *  4. 在 #root 上挂载 React 树，层级为：
 *     ApplicationErrorBoundary → QueryClientProvider → NuqsAdapter → ThemeProvider → App；开发时可通过
 *     VITE_XIRANITE_REACT_STRICT_MODE=1 显式启用 StrictMode。
 */
async function bootstrap() {
  startupDebug("bootstrap:begin")
  await startupDebugAsync("bootstrap:i18n", initI18n)

  await startupDebugAsync("bootstrap:backend-config", hydrateLocalBackendConfig).catch((error) => {
    logger.error("Initial backend config hydrate failed", error)
  })

  attachNodeOperationStoreMirror()

  // A Tauri WebView ignores `-webkit-app-region`, so the frameless captions' drag strips are routed to the
  // host's window manager from one place. See src/backend/windowDragRegion.ts.
  startupDebug("bootstrap:window-drag-region", installNativeWindowDragRegion())

  // Installed frontend plugins are registered from the host's own record, which is what makes a
  // plugin load on the *next* startup without anyone re-typing its URL or rebuilding the host.
  startupDebug("bootstrap:frontend-plugins", activateInstalledFrontendPlugins())

  startupDebug("bootstrap:react-render:begin")
  const app = (
    <ApplicationErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </ApplicationErrorBoundary>
  )
  const root = createRoot(document.getElementById("root")!)
  // StrictMode replays mounts in Vite development. A full NeoView Reader mount
  // decodes a high-resolution page, so that replay causes a second decode and
  // can block the entire WebView before its first interactive frame.
  root.render(import.meta.env.VITE_XIRANITE_REACT_STRICT_MODE === "1"
    ? <StrictMode>{app}</StrictMode>
    : app)
  requestAnimationFrame(() => {
    startupDebug("bootstrap:first-animation-frame")
  })
}
