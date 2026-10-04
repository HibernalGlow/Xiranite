/**
 * Dev/POC entry point for a frontend plugin built **outside this repository**.
 *
 * Open
 *
 *   /plugin-host.html?plugin=<id>&entry=<mf-manifest or remoteEntry url>&type=module|var
 *
 * The page registers the remote with the host's Module Federation instance and renders it through
 * `ModuleRenderer` — the same component the product workspace uses — so what this proves is the
 * integration path, not a bespoke preview. Nothing here pre-loads: the remote's bytes are fetched on
 * the first render of that module id (`registerRemotes` is lazy), which is the lazy-loading
 * requirement in `docs/plugin-architecture.md` §2.2.
 *
 * Deliberately absent: the plugin manager (install/update/registry/`.xplugin`) and `manifest.toml`.
 * The entry URL comes from the query string because the POC's job is to answer whether an external
 * build runs in this realm at all; manifest plumbing only makes sense once that is known.
 */

import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme-provider"
import { hydrateLocalBackendConfig } from "@/backend/localBackendConfig"
import { initI18n } from "@/i18n"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { registerFrontendPlugin } from "@/plugins/frontendRuntime"
import { bindModuleToFrontendPlugin } from "@/plugins/dynamicEntries"
import "./styles/tailwind.css"
import "./index.css"
import "./styles/themes/index.css"

const params = new URLSearchParams(window.location.search)
const pluginId = params.get("plugin")?.trim()
const entry = params.get("entry")?.trim()
const entryType = params.get("type") === "var" ? "var" : "module"
const moduleId = params.get("module")?.trim() || pluginId

function notice(text: string) {
  document.title = "Xiranite Frontend Plugin Host"
  const root = document.getElementById("root")
  if (root) root.innerHTML = `<pre style="padding:16px;font:13px/1.6 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap">${text}</pre>`
}

if (!pluginId || !entry) {
  notice("用法：/plugin-host.html?plugin=<id>&entry=<mf-manifest.json 或 remoteEntry.js 的 URL>[&type=module|var]\n\n例：?plugin=poc-frontend&entry=http://127.0.0.1:4173/mf-manifest.json")
  throw new Error("plugin id and entry URL are required")
}

if (!/^https?:\/\//i.test(entry)) {
  notice(`entry 必须是 http(s) URL，收到：${entry}`)
  throw new Error("plugin entry URL must be absolute http(s)")
}

const spec = { id: pluginId, entry, entryType }
registerFrontendPlugin(spec)
bindModuleToFrontendPlugin(moduleId!, spec)

await initI18n()
void hydrateLocalBackendConfig()

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
})

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <div style={{ padding: 16, minHeight: "100%" }}>
        <div style={{ font: "12px/1.6 ui-monospace,SFMono-Regular,monospace", opacity: 0.7, marginBottom: 12 }}>
          plugin {pluginId} ← {entry} (type={entryType}); module id {moduleId}
        </div>
        <ModuleRenderer moduleId={moduleId!} compId="plugin-host" />
      </div>
    </ThemeProvider>
  </QueryClientProvider>,
)
