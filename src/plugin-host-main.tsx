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
import {
  assertPluginResources,
  declarePluginTrust,
  enumeratePluginArtifacts,
  forgetPluginTrust,
  pluginTrust,
} from "@/plugins/frontendIntegrity"
import { approveFrontendPluginCapabilities, revokeFrontendPluginApproval } from "@/plugins/frontendGrants"
import { previewFrontendPluginManifest, previewFrontendPluginRecord, type PluginInstallPreview } from "@/plugins/pluginManifestInstall"
import {
  activateInstalledFrontendPlugins,
  setFrontendPluginEnabled,
  uninstallFrontendPlugin,
  canInstallFrontendPluginFromUrl,
  discoverInstalledFrontendPlugins,
  installFrontendPlugin,
  updateFrontendPlugin,
} from "@/plugins/pluginRegistry"
import { checkFrontendPluginUpdate, installFrontendPluginFromManifestUrl } from "@/plugins/pluginManifestInstall"
import { checkFrontendApiRequirement, XIRANITE_FRONTEND_API_VERSION } from "@/plugins/frontendApi"
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
/**
 * `&type=` must spell one of the two entry kinds, or the load is refused.
 *
 * The old reading was `=== "var" ? "var" : "module"`, so `type=modul`, `type=systemjs` and even
 * `type=` all became a silent module install. The shipped manifest reader refuses those spellings
 * outright (§2.1's fail-closed rule, same reasoning as the declared-blank `required_api`), and a query
 * path that is more lenient than the distribution path is a foot-gun that only bites later.
 */
const rawEntryType = params.has("type") ? (params.get("type") ?? "").trim() : "module"
if (rawEntryType !== "module" && rawEntryType !== "var") {
  notice(`&type 只接受 module | var，收到：${rawEntryType === "" ? "（空值）" : rawEntryType}`)
  throw new Error("unknown frontend entry type")
}
const entryType: "module" | "var" = rawEntryType

/** Declared grants, comma-separated; an empty parameter means nothing is granted. */
function capabilitiesFromQuery(): readonly NodeCapabilityId[] | undefined {
  const raw = params.get("capabilities")
  if (raw === null) return undefined
  return raw.split(",").map((value) => value.trim()).filter((value) => value.length > 0) as NodeCapabilityId[]
}

const trust = params.get("trust")?.trim() === "internal" ? ("internal" as const) : undefined

/**
 * `&requiredApi=^1.0` — §2.1's `required_api`, the range this plugin needs over the host's
 * plugin-facing frontend API. Checked at install (`validateFrontendPlugin`), never at render.
 */
const requiredApiParam = params.get("requiredApi")?.trim() || undefined

/** `&version=1.1.0` — the plugin's own release number (§2.1), carried on the record. */
const versionParam = params.get("version")?.trim() || undefined

/**
 * `&mode=update` replaces an installed record through §4's unload step instead of adding one.
 *
 * It still arrives from a query string, so the dev-only gate applies to it exactly as it does to an
 * install: changing what the host loads is the same privilege as adding it.
 */
const requestedMode = params.get("mode")?.trim() === "update" ? ("update" as const) : ("install" as const)

/**
 * `&manifestUrl=<…/manifest.toml>` installs from Xiranite's own manifest (§2.1) instead of from the
 * query string. It is still a URL the caller typed, so it goes through the same dev-only gate — the
 * manifest says *what* to load, not *who may* load it.
 */
const manifestUrl = params.get("manifestUrl")?.trim() || undefined

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
const startupReport = activateInstalledFrontendPlugins()

/** Set when this load came from a `manifest.toml`; the page then reads back the manifest's own words. */
let installedFromManifest: { moduleId: string; entry: string; version?: string; requiredApi?: string; notes: string[] } | undefined
/**
 * `&preview=1` reads the manifest and says what installing it would do, then stops — §2.5 puts
 * `validate (manifest + api compat + capabilities)` before `resolve`/`load`, and until now the host
 * only ever reported those results after the record was written.
 */
const previewRequested = params.get("preview")?.trim() === "1"
/** One shape for both entry points, so the report cannot end up describing only the manifest path. */
let previewOutcome: { preview?: PluginInstallPreview; issues?: string[]; notes?: string[] } | undefined
if (manifestUrl) {
  if (!canInstallFrontendPluginFromUrl()) {
    notice(
      "生产构建不接受「用 URL 装插件」，manifestUrl 也是 URL 入口：它能指向任何地方，"
      + "而授权确认还没有 UI（§10.1 第 3 条）。\n"
      + "已经装过的插件在生产构建里照常加载：只带 ?module=<已安装的 moduleId> 即可。",
    )
    throw new Error("installing a frontend plugin from a URL is development-only")
  }
  if (previewRequested) {
    // Read-only on purpose: a report that installed the plugin first would be describing a done deal.
    const response = await fetch(manifestUrl, { credentials: "omit" })
    if (!response.ok) {
      notice(`manifest 取不回来：${response.status} ${response.statusText}`)
      throw new Error("manifest fetch failed")
    }
    const tomlText = await response.text()
    const first = previewFrontendPluginManifest(tomlText, { baseUrl: response.url || manifestUrl })
    // Second pass with the artifact list: coverage numbers are about what will be fetched, and the entry
    // is only known once the manifest parsed.
    const preview = first.ok
      ? previewFrontendPluginManifest(tomlText, {
          baseUrl: response.url || manifestUrl,
          artifacts: await artifactsFor(first.preview.entry),
        })
      : first
    if (!preview.ok) {
      previewOutcome = { issues: preview.issues.map((issue) => `拒绝安装：${issue.field}: ${issue.message}`) }
    } else {
      previewOutcome = { preview: preview.preview, notes: preview.notes }
    }
  } else {
    const outcome = await installFrontendPluginFromManifestUrl(manifestUrl)
    if (!outcome.ok) {
      notice(`manifest 未通过校验：\n${outcome.issues.map((issue) => `${issue.field}: ${issue.message}`).join("\n")}`)
      throw new Error("plugin manifest is invalid")
    }
    installedFromManifest = {
      moduleId: outcome.install.ok ? outcome.install.plugin.moduleId : (outcome.manifest.frontend.alias ?? outcome.manifest.id),
      entry: outcome.manifest.frontend.entry,
      version: outcome.manifest.version,
      requiredApi: outcome.manifest.frontend.requiredApi,
      notes: outcome.notes,
    }
  }
}

const moduleIdParam = params.get("module")?.trim() || pluginId
const moduleId = installedFromManifest?.moduleId ?? moduleIdParam
const storedPlugin = moduleId ? frontendPluginForModule(moduleId) : undefined

/**
 * `&mode=check-update` asks the recorded manifest source what version it declares now (§2.5's
 * `update`). Read-only: it never writes a record, and it refuses when the record has no manifest
 * source rather than guessing from the entry URL.
 */
const updateCheckTarget = requestedMode === "update" ? undefined : params.get("checkUpdate")?.trim()
const updateCheck = updateCheckTarget === "" || (updateCheckTarget && updateCheckTarget.length > 0)
  ? await checkFrontendPluginUpdate(updateCheckTarget || targetModuleIdForCheck(moduleId, pluginId))
  : undefined

function targetModuleIdForCheck(moduleIdValue: string | undefined, pluginIdValue: string | undefined): string {
  return pluginIdValue ?? moduleIdValue ?? ""
}
const storedRecord = moduleId
  ? discoverInstalledFrontendPlugins().plugins.find((record) => record.moduleId === moduleId)
  : undefined

/**
 * `&lifecycle=disable|enable|uninstall|revoke-grant` runs one of the verbs §2.5 lists for a manager.
 *
 * They already existed in `pluginRegistry.ts` with full teardown semantics and no caller outside a
 * test file — which is the same "documented but unreachable" shape this document keeps refusing. This
 * page is the caller until the settings panel exists, and it is dev-only for the same reason install
 * is: turning off what the host loads is the same privilege as adding it.
 *
 * Each branch says whether anything actually happened, because "disabled" and "there was no record to
 * disable" must not print the same line.
 */
const lifecycleVerbs = ["disable", "enable", "uninstall", "revoke-grant"] as const
type LifecycleVerb = (typeof lifecycleVerbs)[number]
const lifecycleRaw = params.get("lifecycle")?.trim()
const lifecycleVerb = lifecycleRaw && (lifecycleVerbs as readonly string[]).includes(lifecycleRaw)
  ? (lifecycleRaw as LifecycleVerb)
  : undefined
if (lifecycleRaw && !lifecycleVerb) {
  notice(`&lifecycle 只接受 ${lifecycleVerbs.join(" | ")}，收到：${lifecycleRaw}`)
  throw new Error("unknown lifecycle verb")
}

let lifecycleNote: string | undefined
if (lifecycleVerb) {
  if (!canInstallFrontendPluginFromUrl()) {
    notice("生命周期动词（停用/卸载/撤销批准）只在 dev 构建开放：它改变宿主加载什么，与安装同级。")
    throw new Error("lifecycle verbs are development-only")
  }
  const target = pluginId?.trim() || storedRecord?.id || ""
  if (!target) {
    notice("&lifecycle 需要 ?plugin=<id>，或者 ?module=<moduleId> 能反查到已装记录")
    throw new Error("lifecycle verb needs a plugin id")
  }
  if (lifecycleVerb === "revoke-grant") {
    // Only the approval disappears: the record and its contributions stay, which is the point of
    // revocation existing separately from uninstall.
    lifecycleNote = revokeFrontendPluginApproval(target)
      ? `已撤销 ${target} 的批准记录（命名空间收回到只剩 contract；记录与贡献仍在）`
      : `${target} 本来就没有批准记录，什么都没做`
  } else if (lifecycleVerb === "uninstall") {
    lifecycleNote = uninstallFrontendPlugin(target)
      ? `已卸载 ${target}（记录、绑定、贡献、pin/origin、批准一起撤）`
      : `${target} 没装过，什么都没做`
  } else {
    const enabled = lifecycleVerb === "enable"
    lifecycleNote = setFrontendPluginEnabled(target, enabled)
      ? `已${enabled ? "启用" : "停用"} ${target}（停用 = 解绑 + 清贡献 + 忘 pin/origin；批准记录**留着**，撤销是 revoke-grant 那一刀，已求值的模块不回收 §4）`
      : `${target} 没有可改的记录（未安装，或记录已不合法），什么都没做`
  }
}

// `mode=update` deliberately takes the update path even though the module is already bound; that is
// the whole point of the verb. A lifecycle verb never re-installs whatever it just changed.
// A preview is not an install either: without this term the page demands `&plugin=`/`&entry=` on a run
// that deliberately wrote nothing (measured — the first live attempt died on that notice instead of
// rendering the report).
const installing = (requestedMode === "update" || !storedPlugin) && !lifecycleVerb && !previewRequested

if (installing && !canInstallFrontendPluginFromUrl()) {
  notice(
    "生产构建不接受「用 URL 装插件」：这个页面在 vite 的生产 input 表里，"
    + "若允许 query 直接注册 remote，就等于任何能打开这个地址的人都能把代码塞进宿主 realm。\n"
    + "授权确认（§10.1 第 3 条）还没有 UI，所以先关到 dev 构建。\n\n"
    + "已安装过的插件在生产构建里照常加载：只带 ?module=<已安装的 moduleId> 即可。",
  )
  throw new Error("installing a frontend plugin from a URL is development-only")
}

if (installing && (!pluginId || !entry)) {
  notice(
    `用法（首次安装）：/src/entrypoints/plugin-host.html?plugin=<id>&entry=<mf-manifest.json 或 remoteEntry.js>&type=module|var[&capabilities=…][&requiredApi=^1.0][&pin=<url>|<sri>][&origin=…]\n\n`
      + `启动账（三态分开，停用不等于被拒）：已激活 ${startupReport.activated.join(", ") || "（无）"}`
      + `｜已停用 ${startupReport.disabled.join(", ") || "（无）"}`
      + `｜被拒 ${startupReport.refused.map((issue) => `${issue.field}: ${issue.message}`).join("；") || "（无）"}`
      + `\n装好之后只带 ?module=<moduleId> 就能再打开。`,
  )
  throw new Error("plugin id and entry URL are required for a first install")
}

if (installing && !/^https?:\/\//i.test(entry ?? "")) {
  notice(`entry 必须是 http(s) URL，收到：${entry}`)
  throw new Error("plugin entry URL must be absolute http(s)")
}

/**
 * `&contributes=<id>[|<显示名>][@<./Expose>]`, repeatable: the components this plugin adds to the host.
 *
 * The `@` part is what makes a multi-component plugin expressible without the manifest path: each row
 * names which of the remote's exposes backs it (`contributions.ts` → `dynamicEntries.exposeOfModule`).
 */
function contributionsFromQuery() {
  const entries = params.getAll("contributes").map((raw) => {
    const at = raw.indexOf("@")
    const head = at < 0 ? raw : raw.slice(0, at)
    const module = at < 0 ? undefined : raw.slice(at + 1).trim()
    const separator = head.indexOf("|")
    const id = (separator < 0 ? head : head.slice(0, separator)).trim()
    const name = separator < 0 ? undefined : head.slice(separator + 1).trim()
    return {
      kind: "component" as const,
      id,
      ...(name ? { name } : {}),
      ...(module ? { module } : {}),
    }
  }).filter((entry) => entry.id.length > 0)
  return entries.length > 0 ? entries : undefined
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

/**
 * Which bytes the remote will fetch, read from Module Federation's own metadata so the pin report gets a
 * denominator instead of a claim.
 *
 * §2.1 forbids using `mf-manifest.json` as Xiranite's plugin manifest; this takes no identity, version or
 * lifecycle fact from it, only the list of URLs the loader pulls. When it cannot be read (an entry that is
 * the container itself, a 404, bad JSON) the caller gets the entry alone with `enumerated: false`, and the
 * report then says it did not look rather than reporting a clean sheet.
 */
async function artifactsFor(entryUrl: string): Promise<readonly string[]> {
  try {
    const response = await fetch(entryUrl, { credentials: "omit" })
    if (!response.ok) return [entryUrl]
    return enumeratePluginArtifacts(entryUrl, JSON.parse(await response.text()))
  } catch {
    return [entryUrl]
  }
}

/**
 * `&preview=1` without a manifest previews the record this page would have assembled from the query.
 *
 * The same validator, the same planner and the same projection lookup as the install it stands in for,
 * so the two paths cannot report different numbers. Nothing here writes trust either.
 */
const queryCandidate = previewRequested && !manifestUrl && pluginId && entry
  ? {
      ...spec,
      moduleId: targetModuleId,
      version: versionParam,
      requiredApi: requiredApiParam,
      contributions: contributionsFromQuery(),
    }
  : undefined
const queryPreview = queryCandidate
  ? previewFrontendPluginRecord(queryCandidate, { artifacts: await artifactsFor(queryCandidate.entry) })
  : undefined
if (queryPreview) {
  previewOutcome = queryPreview.ok
    ? { preview: queryPreview.preview }
    : { issues: queryPreview.issues.map((issue) => `拒绝安装：${issue.field}: ${issue.message}`) }
}

if (installing) {
  /**
   * Fail before registering when a pinned resource already disagrees with its hash.
   *
   * Without this the first thing a bad pin shows up as is a half-loaded remote inside a Suspense
   * boundary; with it the page says which URL mismatched.
   */
  // A refusal must not leave anything behind. Pin/origin declarations are snapshotted so both failure
  // paths put them back, and the approval is written only after the record itself has been accepted:
  // approving first means a refused install keeps a grant nobody owns (measured on this page — the
  // hash pre-flight ran before validation, so a rejected record had already been approved).
  const previousTrust = pluginTrust(spec.id)
  const restoreTrust = () => {
    if (previousTrust) declarePluginTrust(spec.id, previousTrust)
    else forgetPluginTrust(spec.id)
  }
  try {
    declarePluginTrust(spec.id, { integrity, allowedOrigins: spec.allowedOrigins })
    await assertPluginResources(spec.id, Object.keys(integrity))
  } catch (error) {
    restoreTrust()
    notice(
      `插件资源校验失败：\n${error instanceof Error ? error.message : String(error)}\n`
      + "（pin/来源声明已回滚，批准记录没写、记录也没装）",
    )
    throw error
  }

  /**
   * Installing (not just registering) is what makes the record survive a reload.
   */
  const candidate = {
    ...spec,
    moduleId: targetModuleId,
    version: versionParam ?? storedRecord?.version,
    requiredApi: requiredApiParam ?? storedRecord?.requiredApi,
    contributions: contributionsFromQuery() ?? storedRecord?.contributions,
  }
  const installedRecord = requestedMode === "update"
    ? updateFrontendPlugin(candidate)
    : installFrontendPlugin(candidate)
  if (!installedRecord.ok) {
    restoreTrust()
    notice(
      `${requestedMode === "update" ? "更新" : "安装"}未通过校验：\n${installedRecord.issues.map((issue) => `${issue.field}: ${issue.message}`).join("\n")}\n`
      + "（pin/来源声明已回滚，批准记录没写）",
    )
    throw new Error("frontend plugin record is invalid")
  }

  // 批准记的是「这一份装载来源被宿主接受」，所以它排在记录被接受之后。这里仍是今天唯一那个「有人在说
  // yes」的位置（§10.1 第 3 条的授权层；确认对话框还没做）。
  approveFrontendPluginCapabilities(spec.id, candidate.capabilities ?? [])
}

/**
 * The coverage sentence, computed from the enumerated set rather than asserted: how many of the bytes
 * this load will fetch carry no pin, and how many declared pins match nothing the build emits.
 */
function pinCoveragePhrase(preview: PluginInstallPreview): string {
  const unpinned = preview.unpinnedArtifacts.length
  const pinned = preview.enumeratedArtifactCount - unpinned
  return ` · 本次要抓 ${preview.enumeratedArtifactCount} 份产物：${pinned} 份已钉、${unpinned} 份没钉（没钉的就是裸字节）`
    + (unpinned > 0 ? `，例如 ${preview.unpinnedArtifacts.slice(0, 3).join("、")}` : "")
    + (preview.pinsMatchingNothing.length > 0
      ? `；另有 ${preview.pinsMatchingNothing.length} 条 pin 对不上任何产物（构建换了哈希就会这样），等于没钉：${preview.pinsMatchingNothing.join("、")}`
      : "")
}

/** Read back what layer 2 resolved to, so the grant is visible without opening a console. */
const hostAccess = resolveFrontendHostAccess(spec)

/** Which frontend API range applied to *this* load: the record's, or the query's on a first install. */
const apiCheck = checkFrontendApiRequirement(storedPlugin?.requiredApi ?? requiredApiParam)

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
          {(installedFromManifest?.version ?? versionParam ?? storedRecord?.version) ? ` · v${installedFromManifest?.version ?? versionParam ?? storedRecord?.version}` : ""}
          {installedFromManifest ? ` · 来自 manifest.toml（${manifestUrl}）` : ""}
          {previewOutcome ? (
            <div data-xr-preview-report="">
              预检（没装、没批准、没写 pin）：
              {previewOutcome.preview
                ? ` ${previewOutcome.preview.pluginId} 版本 ${previewOutcome.preview.version ?? "（未声明）"} · entry=<code>${previewOutcome.preview.entry}</code>`
                  + ` · frontend_api ${previewOutcome.preview.requiredApi ?? "（未声明）"} → ${previewOutcome.preview.api.compatible ? "满足" : "不满足"}（${previewOutcome.preview.api.detail}）`
                  + ` · pin ${previewOutcome.preview.pinnedResourceCount} 条 · 允许来源 ${previewOutcome.preview.allowedOriginCount} 个`
                  + ` · 入口${previewOutcome.preview.entryIsPinned ? "已钉字节" : "未钉（只信 URL 形状）"}`
                  + (previewOutcome.preview.artifactsEnumerated
                    ? pinCoveragePhrase(previewOutcome.preview)
                    : " · 没读到 MF 那份产物清单，覆盖率不作答（不作答不等于没问题）")
                  + (previewOutcome.preview.unreachablePins.length > 0
                    ? ` · 这些 pin 永远轮不到（来源不在白名单，加载它只会抛错）：${previewOutcome.preview.unreachablePins.join(", ")}`
                    : "")
                  + ` · 会新增模块 [${previewOutcome.preview.listedModules.map((row) => `${row.id}${row.expose ? ` ← ${row.expose}` : ""}`).join(", ") || "（无）"}]`
                  + ` · 装完立刻能拿到 [${previewOutcome.preview.grantedOnInstall.join(", ")}]`
                  + (previewOutcome.preview.unhonouredContributions.length > 0
                    ? ` · 不会成为模块：${previewOutcome.preview.unhonouredContributions.join("；")}`
                    : "")
                : ""}
              {[...(previewOutcome.issues ?? []), ...(previewOutcome.notes ?? [])].map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          ) : null}
          {requestedMode === "update" ? " · 本次走 update" : ""}
          {lifecycleNote ? <> · 生命周期：{lifecycleNote}</> : null}
          {lifecycleVerb
            ? " · 本次只执行生命周期动词（没有安装，也没有改装载来源）"
            : storedPlugin
              ? " · 来自已安装记录（未带 URL 参数）"
              : " · 本次安装"}
          <br />
          host access: trust={hostAccess.trusted ? "internal" : "third-party"} granted=[
          {hostAccess.granted.join(", ")}]
          {hostAccess.refused.length > 0 ? <> refused=[{hostAccess.refused.join(", ")}]</> : null}
          {hostAccess.unapproved.length > 0 ? (
            <> unapproved=[{hostAccess.unapproved.join(", ")}]（声明比决策新，等第 3 层批准）</>
          ) : null}
          <br />
          pins: {Object.keys(spec.integrity ?? {}).length} pinned, origins:{" "}
          {(spec.allowedOrigins ?? []).length > 0 ? (spec.allowedOrigins ?? []).join(", ") : "（未限制）"}
          <br />
          frontend API {XIRANITE_FRONTEND_API_VERSION} · required{" "}
          {apiCheck.required !== undefined ? `"${apiCheck.required}" → ${apiCheck.compatible ? "满足" : "不满足"}` : "（插件未声明）"}
          {" · "}{apiCheck.detail}
          {updateCheck ? (
            <>
              <br />
              版本检查{" "}
              {updateCheck.ok
                ? `${updateCheck.check.pluginId}：记录 ${updateCheck.check.current ?? "（未声明）"} vs 清单 ${updateCheck.check.available ?? "（未声明）"} → ${updateCheck.check.changed ? "不同（要人判断，没装版本大小比较）" : "相同"}`
                : `未通过：${updateCheck.issues.map((issue) => `${issue.field}: ${issue.message}`).join("；")}`}
              {updateCheck.ok ? `（来源 ${updateCheck.check.source}）` : ""}
              {updateCheck.ok && updateCheck.check.grantEffect === "revoked-source-moved" ? (
                <> ⚠️ 应用这次更新会撤掉批准：装载来源从 <code>{updateCheck.check.entryMoved?.from}</code> 移到
                <code>{updateCheck.check.entryMoved?.to}</code>，能力先回到只剩 contract，得重新批准</>
              ) : null}
              {updateCheck.ok && updateCheck.check.grantEffect === "kept" ? " · 装载来源没变，批准仍然算数" : ""}
            </>
          ) : null}
          {(installedFromManifest?.notes.length ?? 0) > 0 ? (
            <>
              <br />
              清单里没人读的部分：{installedFromManifest!.notes.join("；")}
            </>
          ) : null}
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
