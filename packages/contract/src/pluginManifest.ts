import { parse as parseToml } from "smol-toml"

import { checkContractVersion } from "./versionRange.js"

/**
 * `docs/plugin-architecture.md` §2.1: `manifest.toml` is Xiranite's own declaration, and the
 * `[frontend]` half of it belongs to the TypeScript side (the Rust reader owns `[backend]` and only
 * tolerates the rest). This is that reader — the one place the manifest vocabulary is interpreted, so
 * the app, the CLI and any future manager cannot each invent their own spelling of "entry type".
 *
 * Three rules shape it:
 * - **Errors are data** (ADR-0073): everything wrong with a manifest comes back as an issue list, all
 *   of it in one pass. A parser that throws on the first problem makes an install dialog show one
 *   error at a time.
 * - **Fail closed on the runtime name.** `[frontend] runtime` must be exactly
 *   {@link FRONTEND_RUNTIME}. A manifest naming a runtime this host cannot load is refused, not quietly
 *   run as module-federation — the same posture `crates/xiranite-node-runtime/src/manifest.rs` takes
 *   for `[backend]`, which is why this file lives next to the other contract rather than in the app.
 * - **Policy stays with the caller.** The host's own frontend API version is *passed in*, because what
 *   version a given build publishes is the host's decision; the parser only evaluates the declared
 *   range against it. Without one, a CLI can still read a manifest for a host it is not running.
 */

/** The only `[frontend] runtime` value accepted; anything else is an issue, not a fallback. */
export const FRONTEND_RUNTIME = "module-federation"

/** §2.1's contribution kinds. `route` is deliberately absent: there is no URL router to consume it. */
export const PLUGIN_CONTRIBUTION_KINDS = ["component", "tray", "window"] as const

export type PluginContributionKind = (typeof PLUGIN_CONTRIBUTION_KINDS)[number]

export interface ManifestIssue {
  field: string
  message: string
}

export interface ParsedFrontendSection {
  /** Already absolute: `manifest` is resolved against the manifest's own URL or directory. */
  entry: string
  entryType: "module" | "var"
  alias?: string
  shareScope?: string
  requiredApi?: string
  allowedOrigins?: string[]
  /** Absolute URL → SRI, the same shape `frontendIntegrity.ts` matches by exact URL. */
  integrity?: Record<string, string>
}

export interface ParsedPluginManifest {
  id: string
  name?: string
  description?: string
  version?: string
  frontendApi?: string
  frontend: ParsedFrontendSection
  contributions?: Array<{ kind: PluginContributionKind; id: string; name?: string; module?: string }>
  /** `[permissions]` is read by nobody today; kept verbatim so a reader can report it instead of dropping it. */
  permissions?: Record<string, unknown>
}

export type PluginManifestParseResult =
  | { ok: true; manifest: ParsedPluginManifest }
  | { ok: false; issues: ManifestIssue[] }

const SRI_PATTERN = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+)={0,2}$/
const SRI_LENGTHS: Record<string, number> = { sha256: 44, sha384: 64, sha512: 88 }

/** A truncated or malformed pin is rejected here, at the boundary, rather than at load time. */
export function isUsableSri(value: unknown): boolean {
  if (typeof value !== "string") return false
  const match = SRI_PATTERN.exec(value.trim())
  return match !== null && SRI_LENGTHS[match[1] ?? ""] === match[2]?.length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function httpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Reads the `[frontend]` half of a plugin manifest.
 *
 * @param tomlText the manifest body
 * @param options.baseUrl the manifest's own URL (or a directory URL with a trailing slash) so relative
 *   `manifest` paths resolve; omit for a disk read where the caller will resolve the path itself
 * @param options.hostFrontendApiVersion the host's plugin-facing frontend API version; when supplied,
 *   `required_api` is evaluated against it with the same {@link checkContractVersion} the runtime uses
 */
export function parseFrontendPluginManifest(
  tomlText: string,
  options: { baseUrl?: string; hostFrontendApiVersion?: string } = {},
): PluginManifestParseResult {
  const issues: ManifestIssue[] = []

  let root: unknown
  try {
    root = parseToml(tomlText)
  } catch (error) {
    return {
      ok: false,
      issues: [{ field: "manifest", message: `not readable TOML: ${error instanceof Error ? error.message : String(error)}` }],
    }
  }
  if (!isRecord(root)) return { ok: false, issues: [{ field: "manifest", message: "expected a table at the top level" }] }

  const id = text(root.id)
  if (!id) issues.push({ field: "id", message: "must be a non-empty string" })

  const section = root.frontend
  if (!isRecord(section)) {
    issues.push({ field: "frontend", message: "a frontend plugin needs a [frontend] section" })
  }

  const frontend: ParsedFrontendSection = { entry: "", entryType: "module" }
  if (isRecord(section)) {
    const runtime = text(section.runtime)
    if (runtime === undefined) issues.push({ field: "frontend.runtime", message: "must be present" })
    else if (runtime !== FRONTEND_RUNTIME) {
      issues.push({
        field: "frontend.runtime",
        message: `"${runtime}" is not a runtime this host loads; only "${FRONTEND_RUNTIME}" is`,
      })
    }

    const manifestPath = text(section.manifest)
    if (!manifestPath) {
      issues.push({ field: "frontend.manifest", message: "must be a path or absolute URL to the remote entry" })
    } else if (options.baseUrl) {
      const base = options.baseUrl
      const resolved = new URL(
        manifestPath,
        base.endsWith("/") ? base : `${base.replace(/[^/]*$/, "")}`,
      ).href
      if (!httpUrl(resolved)) {
        issues.push({ field: "frontend.manifest", message: `resolved to a non-http(s) URL: ${resolved}` })
      } else {
        frontend.entry = resolved
      }
    } else if (httpUrl(manifestPath)) {
      frontend.entry = manifestPath
    } else {
      issues.push({ field: "frontend.manifest", message: `"${manifestPath}" is relative and no baseUrl was given` })
    }

    const entryType = text(section.entry_type)
    if (entryType === undefined) {
      frontend.entryType = "module"
    } else if (entryType === "module" || entryType === "var") {
      frontend.entryType = entryType
    } else {
      issues.push({ field: "frontend.entry_type", message: 'must be "module" or "var"' })
    }

    const alias = text(section.alias)
    if (alias !== undefined) frontend.alias = alias
    const shareScope = text(section.share_scope)
    if (shareScope !== undefined) frontend.shareScope = shareScope

    const requiredApi = text(section.required_api)
    if (requiredApi !== undefined) {
      frontend.requiredApi = requiredApi
      if (options.hostFrontendApiVersion) {
        const verdict = checkContractVersion(requiredApi, options.hostFrontendApiVersion)
        if (!verdict.compatible) {
          issues.push({
            field: "frontend.required_api",
            message: `host frontend API ${options.hostFrontendApiVersion} does not satisfy "${requiredApi}" (${verdict.reason}: ${verdict.detail})`,
          })
        }
      }
    }

    if (section.source_allow_list !== undefined) {
      if (!Array.isArray(section.source_allow_list) || !section.source_allow_list.every((v) => typeof v === "string" && httpUrl(v))) {
        issues.push({ field: "frontend.source_allow_list", message: "must be an array of absolute http(s) URLs" })
      } else {
        frontend.allowedOrigins = section.source_allow_list as string[]
      }
    }

    if (section.integrity !== undefined) {
      if (!isRecord(section.integrity)) {
        issues.push({ field: "frontend.integrity", message: "must be a [frontend.integrity] table of url = sri" })
      } else {
        const pins: Record<string, string> = {}
        for (const [url, sri] of Object.entries(section.integrity)) {
          if (!httpUrl(url)) issues.push({ field: `frontend.integrity.${url}`, message: "key must be an absolute http(s) URL" })
          if (!isUsableSri(sri)) {
            issues.push({ field: `frontend.integrity.${url}`, message: "value must be a full SRI like sha384-… (64 base64 chars)" })
          } else {
            pins[url] = (sri as string).trim()
          }
        }
        if (Object.keys(pins).length > 0) frontend.integrity = pins
      }
    }
  }

  const contributions: NonNullable<ParsedPluginManifest["contributions"]> = []

  // `[[frontend.exposes]]` is the sugar §2.1 documents for the one kind a remote really adds; the
  // canonical `[[contributions]]` list is read too, where the manifest spells the discriminator
  // `type` and the record spells it `kind`. This function is the single place that rename happens.
  const originOf = new Map<string, "frontend.exposes" | "contributions">()
  const noteContribution = (idValue: string, origin: "frontend.exposes" | "contributions", entry: NonNullable<ParsedPluginManifest["contributions"]>[number]) => {
    const previous = originOf.get(idValue)
    if (previous !== undefined && previous !== origin) {
      issues.push({
        field: `contributions.${idValue}`,
        message: `"${idValue}" is contributed twice: once via [[${previous === "frontend.exposes" ? "frontend.exposes" : "contributions"}]] and once via [[${origin === "frontend.exposes" ? "frontend.exposes" : "contributions"}]]`,
      })
      return
    }
    originOf.set(idValue, origin)
    contributions.push(entry)
  }

  for (const [index, raw] of arrayOfTables(root.frontend, "exposes").entries()) {
    const idValue = text(raw.id)
    const moduleValue = text(raw.module)
    if (!idValue) issues.push({ field: `frontend.exposes[${index}].id`, message: "must be a non-empty string" })
    if (!moduleValue) issues.push({ field: `frontend.exposes[${index}].module`, message: 'must be the expose key, e.g. "./entry"' })
    if (idValue && moduleValue) noteContribution(idValue, "frontend.exposes", { kind: "component", id: idValue, module: moduleValue })
  }
  for (const [index, raw] of arrayOfTables(root, "contributions").entries()) {
    const discriminator = text(raw.kind) ?? text(raw.type)
    const idValue = text(raw.id)
    if (!idValue) issues.push({ field: `contributions[${index}].id`, message: "must be a non-empty string" })
    if (!discriminator || !(PLUGIN_CONTRIBUTION_KINDS as readonly string[]).includes(discriminator)) {
      issues.push({
        field: `contributions[${index}].type`,
        message: `must be one of ${PLUGIN_CONTRIBUTION_KINDS.join(", ")}; "${discriminator ?? ""}" has no reader here`,
      })
      continue
    }
    if (idValue) {
      noteContribution(idValue, "contributions", {
        kind: discriminator as PluginContributionKind,
        id: idValue,
        name: text(raw.name),
        module: text(raw.module),
      })
    }
  }

  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    manifest: {
      id: id!,
      name: text(root.name),
      description: text(root.description),
      version: text(root.version),
      frontendApi: text(root.frontend_api),
      frontend,
      contributions: contributions.length > 0 ? contributions : undefined,
      permissions: isRecord(root.permissions) ? root.permissions : undefined,
    },
  }
}

function arrayOfTables(parent: unknown, key: string): Array<Record<string, unknown>> {
  if (!isRecord(parent)) return []
  const value = parent[key]
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

