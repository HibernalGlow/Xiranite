/**
 * Dev/POC entry point for a frontend plugin built **outside this repository**.
 *
 * Open
 *
 *   /plugin-host.html?plugin=<id>&entry=<mf-manifest or remoteEntry url>&type=module|var
 *
 * and, when the tab is not the Tauri WebView (so no `xiranite_bootstrap` exists), append
 * `&backend=http://127.0.0.1:<port>&token=<per-instance token>&instance=<instanceId>` — the three
 * values `xiranite-dev-host` prints.
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
 *
 * Capability grants also come from the query string (`&capabilities=state,config`), because layer 2 of
 * `docs/plugin-architecture.md` §10.1 (声明 → 授权) has no other source until the PluginManager reads
 * `[permissions]`. Omit it and the plugin gets `contract` only — that is the default-deny the same
 * section requires, and the page prints what was granted and what was refused so the answer is
 * readable without opening a console. `&trust=internal` is the built-in-node case of §2.4 (阶段二
 * loads a repo node's own `entry.ts`, which is trusted by construction) and is opt-in per URL.
 */

import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@/components/theme-provider"
import { hydrateLocalBackendConfig, setLocalBackendConfig } from "@/backend/localBackendConfig"
import { initI18n } from "@/i18n"
import { ModuleRenderer } from "@/components/modules/ModuleRenderer"
import { useWorkspaceStore } from "@/store/workspaceStore"
import { assertPluginResources, declarePluginTrust } from "@/plugins/frontendIntegrity"
import { activateInstalledFrontendPlugins, installFrontendPlugin } from "@/plugins/pluginRegistry"
import { frontendPluginForModule } from "@/plugins/dynamicEntries"
import type { FrontendPluginSpec } from "@/plugins/frontendRuntime"

import { resolveFrontendHostAccess } from "@/plugins/frontendHost"
import type { NodeCapabilityId } from "@xiranite/contract"
import "./styles/tailwind.css"
import "./index.css"
import "./styles/themes/index.css"

const params = new URLSearchParams(window.location.search)
const pluginId = params.get("plugin")?.trim()
const entry = params.get("entry")?.trim()
const entryType: "module" | "var" = params.get("type") === "var" ? "var" : "module"
const moduleId = params.get("module")?.trim() || pluginId

/** Declared grants, comma-separated; an empty parameter means nothing is granted. */
function capabilitiesFromQuery(): readonly NodeCapabilityId[] | undefined {
  const raw = params.get("capabilities")
  if (raw === null) return undefined
  return raw.split(",").map((value) => value.trim()).filter((value) => value.length > 0) as NodeCapabilityId[]
}

const trust = params.get("trust")?.trim() === "internal" ? ("internal" as const) : undefined

/**
 * Pinned bytes, `&pin=<absolute url>|<sha384-…>`, repeatable; origins likewise with `&origin=`.
 *
 * These are the dev-time stand-in for what `manifest.toml` will carry (`integrity` /
 * `source_allow_list`, §2.1). `bun scripts/plugin-integrity.ts <url>` prints the values.
 */
function pinsFromQuery(): Record<string, string> {
  const pins: Record<string, string> = {}
  for (const raw of params.getAll("pin")) {
    const separator = raw.lastIndexOf("|")
    if (separator <= 0) continue
    pins[raw.slice(0, separator).trim()] = raw.slice(separator + 1).trim()
  }
  return pins
}

/** The component slot this page seeds for the rendered module (see below). */
const COMPONENT_ID = "plugin-host"

/**
 * The channel, when this page is opened in a plain browser instead of the Tauri shell.
 *
 * In production `xiranite_bootstrap` hands the WebView the channel and `hydrateLocalBackendConfig`
 * caches it; a browser tab has no such bridge, and Vite only bakes `VITE_XIRANITE_BACKEND_*` at server
 * start, which makes a just-started Rust host unreachable from an already-running dev server. These
 * three parameters are the dev-only equivalent, and they are validated to loopback because ADR-0065
 * binds the backend to `127.0.0.1` — a page that would happily talk to any host in a query string is
 * not something to leave lying around.
 */
function channelFromQuery(): { baseUrl: string; token?: string; instanceId?: string } | undefined {
  const baseUrl = params.get("backend")?.trim()
  if (!baseUrl) return undefined
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error(`backend must be an absolute URL, got ${baseUrl}`)
  }
  const loopback =
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]")
  if (!loopback) {
    throw new Error(`backend must be an http loopback URL (ADR-0065), got ${baseUrl}`)
  }
  return { baseUrl: parsed.href.replace(/\/$/, ""), token: params.get("token")?.trim() || undefined, instanceId: params.get("instance")?.trim() || undefined }
}

function notice(text: string) {
  document.title = "Xiranite Frontend Plugin Host"
  const root = document.getElementById("root")
  if (root) root.innerHTML = `<pre style="padding:16px;font:13px/1.6 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap">${text}</pre>`
}

/**
 * A plugin that is already in the host's record can be opened by module id alone.
 *
 * That is §9 阶段三 的验收口径写成一个可观察事实：装一次之后，之后的每次加载既不需要 URL，也不需要
 * 重新构建宿主——`src/main.tsx` 启动时调的是同一个 `activateInstalledFrontendPlugins()`。
 */
const activatedAtStartup = activateInstalledFrontendPlugins()
const storedPlugin = moduleId ? frontendPluginForModule(moduleId) : undefined
const installing = !storedPlugin

if (installing && (!pluginId || !entry)) {
  notice(
    `用法（首次安装）：/src/entrypoints/plugin-host.html?plugin=<id>&entry=<mf-manifest.json 或 remoteEntry.js>&type=module|var[&capabilities=…][&pin=<url>|<sri>][&origin=…]\n\n已安装：${
      activatedAtStartup.join(", ") || "（无）"
    }\n装好之后只带 ?module=<moduleId> 就能再打开。`,
  )
  throw new Error("plugin id and entry URL are required for a first install")
}

if (installing && !/^https?:\/\//i.test(entry ?? "")) {
  notice(`entry 必须是 http(s) URL，收到：${entry}`)
  throw new Error("plugin entry URL must be absolute http(s)")
}

const integrity = pinsFromQuery()
const spec: FrontendPluginSpec = storedPlugin ?? {
  id: pluginId!,
  entry: entry!,
  entryType,
  capabilities: capabilitiesFromQuery(),
  trust,
  integrity,
  allowedOrigins: params.getAll("origin").map((value) => value.trim()).filter(Boolean),
}
const targetModuleId = moduleId ?? spec.id

if (installing) {
  /**
   * Fail before registering when a pinned resource already disagrees with its hash.
   *
   * Without this the first thing a bad pin shows up as is a half-loaded remote inside a Suspense
   * boundary; with it the page says which URL mismatched.
   */
  try {
    declarePluginTrust(spec.id, { integrity, allowedOrigins: spec.allowedOrigins })
    await assertPluginResources(spec.id, Object.keys(integrity))
  } catch (error) {
    notice(`插件资源校验失败：\n${error instanceof Error ? error.message : String(error)}`)
    throw error
  }

  /**
   * Installing (not just registering) is what makes the record survive a reload.
   */
  const installedRecord = installFrontendPlugin({ ...spec, moduleId: targetModuleId })
  if (!installedRecord.ok) {
    notice(
      `插件记录未通过校验：\n${installedRecord.issues.map((issue) => `${issue.field}: ${issue.message}`).join("\n")}`,
    )
    throw new Error("frontend plugin record is invalid")
  }
}

/** Read back what layer 2 resolved to, so the grant is visible without opening a console. */
const hostAccess = resolveFrontendHostAccess(spec)

/**
 * Gives the module a component slot before it renders.
 *
 * An internal node's `Component.tsx` is written against `host.state`/`host.workspace`, which read the
 * workspace store by `compId`; a bare page has no component instance, so `host.getData()` would answer
 * `undefined` forever and `patchData` would have nothing to patch. Seeding one instance is what makes
 * the node's own UI behave the way it does in the workspace — this is the host's job, not the plugin's.
 */
const workspace = useWorkspaceStore.getState()
const workspaceId = workspace.activeWorkspaceId ?? workspace.workspaces[0]?.id
if (workspaceId) {
  workspace.ensureComponent({
    id: COMPONENT_ID,
    moduleId: targetModuleId,
    workspaceId,
    state: "docked",
    placement: "workspace",
    z: 1,
    position: { x: 0, y: 0 },
    size: { w: 720, h: 640 },
    data: {},
  })
}

const channel = channelFromQuery()
if (channel) setLocalBackendConfig(channel)

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
          plugin {spec.id} ← {spec.entry} (type={spec.entryType}); module id {targetModuleId}
          {storedPlugin ? " · 来自已安装记录（未带 URL 参数）" : " · 本次安装"}
          <br />
          host access: trust={hostAccess.trusted ? "internal" : "third-party"} granted=[
          {hostAccess.granted.join(", ")}]
          {hostAccess.refused.length > 0 ? <> refused=[{hostAccess.refused.join(", ")}]</> : null}
          <br />
          pins: {Object.keys(spec.integrity ?? {}).length} pinned, origins:{" "}
          {(spec.allowedOrigins ?? []).length > 0 ? (spec.allowedOrigins ?? []).join(", ") : "（未限制）"}
        </div>
        {/*
          The node measures its own surface (`useNodeSurface`) and renders a collapsed variant when the
          container has no height, which a bare page does not give it: without this box the node looks
          broken while it is working exactly as designed. 640px is not a magic number, it is the height
          the seeded component instance was created with, so the page and the store agree.
        */}
        <div style={{ height: 640, minHeight: 0 }}>
          <ModuleRenderer moduleId={targetModuleId} compId={COMPONENT_ID} />
        </div>
      </div>
    </ThemeProvider>
  </QueryClientProvider>,
)
