/**
 * Turns a `manifest.toml` into a host install record — the step §2.1 promised and §9 kept listing as
 * missing ("记录今天来自 query 而不是清单文件").
 *
 * Two boundaries to keep straight:
 * - the **vocabulary** belongs to `@xiranite/contract` (`parseFrontendPluginManifest`), because the
 *   manifest is Xiranite's contract file and the CLI must read the same spelling the app does;
 * - the **policy** stays here: which capabilities a plugin is granted is not in the manifest at all
 *   (§2.1's `[permissions]` is backend-facing, and the frontend ceiling is the host's), and the host's
 *   own frontend API version is what `required_api` is checked against. A reader that let a manifest
 *   hand itself grants or trust would recreate the privilege hole closed in §6.
 *
 * `[frontend] alias` goes to the record's `alias` and therefore to `RemoteInfo.name` — the word
 * `loadRemote` is keyed by — and **not** to `moduleId`, which stays the plugin id. That split is what
 * the live probe forced: the example builds its container as `poc_frontend` (alias) while its plugin id
 * is `poc-frontend`, and conflating the two produced `Module "poc_frontend" failed to load`. A plugin
 * that *replaces* a built-in module still says so, just through the record's `moduleId` (the dev page's
 * `&module=`), not through the manifest's alias.
 */

import {
  parseFrontendPluginManifest,
  type ManifestIssue,
  type ParsedPluginManifest,
  type PluginManifestParseResult,
} from "@xiranite/contract"

import { XIRANITE_FRONTEND_API_VERSION } from "./frontendApi"
import { installFrontendPlugin, type InstallFrontendPluginResult } from "./pluginRegistry"

export type ManifestInstallResult =
  | { ok: true; manifest: ParsedPluginManifest; install: InstallFrontendPluginResult }
  | { ok: false; issues: ManifestIssue[] }

export function frontendPluginRecordFromManifest(
  manifest: ParsedPluginManifest,
): { ok: true; record: Record<string, unknown> } | { ok: false; issues: ManifestIssue[] } {
  const issues: ManifestIssue[] = []

  const contributions = (manifest.contributions ?? []).flatMap((contribution) =>
    contribution.kind === "component"
      ? [{ kind: "component", id: contribution.id, ...(contribution.name ? { name: contribution.name } : {}) }]
      : [],
  )
  const ignored = (manifest.contributions ?? []).filter((contribution) => contribution.kind !== "component")
  for (const contribution of ignored) {
    // Not an error: §10.1 keeps these kinds in the vocabulary, and the contributions table reports
    // them as notes. Saying so here is what keeps "declared" from reading as "installed".
    console.info(`[plugin.manifest] ${contribution.kind} contribution "${contribution.id}" recorded but not honoured yet`)
  }

  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    record: {
      id: manifest.id,
      moduleId: manifest.id,
      alias: manifest.frontend.alias,
      entry: manifest.frontend.entry,
      entryType: manifest.frontend.entryType,
      requiredApi: manifest.frontend.requiredApi,
      version: manifest.version,
      integrity: manifest.frontend.integrity,
      allowedOrigins: manifest.frontend.allowedOrigins,
      contributions: contributions.length > 0 ? contributions : undefined,
    },
  }
}

/**
 * Parses manifest text and installs it in one step, so a caller cannot skip the host's own version
 * check by reading the file with a hand-picked base URL.
 */
export function installFrontendPluginFromManifestText(
  tomlText: string,
  options: { baseUrl: string },
): ManifestInstallResult {
  const parsed: PluginManifestParseResult = parseFrontendPluginManifest(tomlText, {
    baseUrl: options.baseUrl,
    hostFrontendApiVersion: XIRANITE_FRONTEND_API_VERSION,
  })
  if (!parsed.ok) return { ok: false, issues: parsed.issues }

  const mapped = frontendPluginRecordFromManifest(parsed.manifest)
  if (!mapped.ok) return { ok: false, issues: mapped.issues }

  return { ok: true, manifest: parsed.manifest, install: installFrontendPlugin(mapped.record) }
}

/**
 * Fetches and installs a manifest over HTTP(S).
 *
 * `credentials: "omit"` because a plugin manifest is a public artifact and this origin carries the
 * host's bearer token in storage, not in cookies — nothing about fetching a third party's file should
 * send anything with it.
 */
export async function installFrontendPluginFromManifestUrl(url: string): Promise<ManifestInstallResult> {
  let response: Response
  try {
    response = await fetch(url, { credentials: "omit" })
  } catch (error) {
    return {
      ok: false,
      issues: [{ field: "manifestUrl", message: `could not be fetched: ${error instanceof Error ? error.message : String(error)}` }],
    }
  }
  if (!response.ok) {
    return { ok: false, issues: [{ field: "manifestUrl", message: `answered ${response.status} ${response.statusText}` }] }
  }
  return installFrontendPluginFromManifestText(await response.text(), { baseUrl: response.url || url })
}
