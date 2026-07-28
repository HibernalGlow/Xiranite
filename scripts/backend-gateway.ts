import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface BackendGatewayTarget {
  baseUrl: string
  token?: string
}

export const BACKEND_GATEWAY_PATH_PREFIX = "/_xiranite/backend"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function backendGatewayPublicUrl(frontendUrl: string): string {
  const url = new URL(frontendUrl)
  url.pathname = BACKEND_GATEWAY_PATH_PREFIX
  url.search = ""
  url.hash = ""
  return url.href.replace(/\/$/u, "")
}

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
  return backendGatewayRoutePath(pathname) !== undefined
}

export function backendGatewayTargetUrl(requestUrl: string, targetBaseUrl: string): URL | undefined {
  const request = new URL(requestUrl, "http://xiranite.local")
  const targetPath = backendGatewayRoutePath(request.pathname)
  if (!targetPath) return undefined

  const target = new URL(targetBaseUrl)
  target.pathname = `${target.pathname.replace(/\/+$/u, "")}${targetPath}`
  target.search = request.search
  target.hash = ""
  return target
}

function backendGatewayRoutePath(pathname: string): string | undefined {
  if (pathname === BACKEND_GATEWAY_PATH_PREFIX) return "/"
  if (!pathname.startsWith(`${BACKEND_GATEWAY_PATH_PREFIX}/`)) return undefined
  return pathname.slice(BACKEND_GATEWAY_PATH_PREFIX.length)
}
