import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface BackendGatewayTarget {
  baseUrl: string
  token?: string
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function backendGatewayTargetPath(frontendUrl: string): string {
  const frontend = new URL(frontendUrl)
  const port = frontend.port || (frontend.protocol === "https:" ? "443" : "80")
  return resolve(repoRoot, ".cache", "backend-gateway", `target-${port}.json`)
}

export async function writeBackendGatewayTarget(target: BackendGatewayTarget, frontendUrl: string): Promise<void> {
  const path = backendGatewayTargetPath(frontendUrl)
  const temporaryPath = `${path}.${process.pid}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(target)}\n`, "utf8")
  await rename(temporaryPath, path)
}

export async function readBackendGatewayTarget(path: string): Promise<BackendGatewayTarget> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!value || typeof value !== "object") throw new Error("Backend gateway target must be an object.")
  const target = value as Partial<BackendGatewayTarget>
  if (typeof target.baseUrl !== "string" || !target.baseUrl.trim()) {
    throw new Error("Backend gateway target must include baseUrl.")
  }
  return {
    baseUrl: target.baseUrl,
    token: typeof target.token === "string" ? target.token : undefined,
  }
}

export async function removeBackendGatewayTarget(frontendUrl: string): Promise<void> {
  await rm(backendGatewayTargetPath(frontendUrl), { force: true })
}

export function isBackendGatewayPath(pathname: string): boolean {
  if (FRONTEND_CONFIG_ASSET_PATHS.has(pathname)) return false
  return BACKEND_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

const FRONTEND_CONFIG_ASSET_PATHS = new Set([
  "/config/webview2-flags.json",
])

const BACKEND_ROUTE_PREFIXES = [
  "/config",
  "/health",
  "/local-files",
  "/logs",
  "/melodeck",
  "/nexus",
  "/node-operations",
  "/node-run-history",
  "/nodes",
  "/reader",
  "/runtime-history",
  "/system",
  "/workspace",
] as const
