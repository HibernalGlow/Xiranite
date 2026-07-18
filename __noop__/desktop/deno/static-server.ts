import type { DesktopBackendConfig } from "../bridge.ts"

const DIST_ROOT = new URL("../../dist/", import.meta.url)
const BRIDGE_PATH = "/__xiranite_desktop_bridge"

export interface DesktopBridge {
  dispatch(name: string, args: unknown[]): Promise<unknown>
}

export interface DesktopAssetServer {
  server: Deno.HttpServer
  frontendBaseUrl: string
}

export function startDesktopAssetServer(
  backendConfig: DesktopBackendConfig | undefined,
  bridge: DesktopBridge,
  frontendDevUrl = clean(Deno.env.get("FRONTEND_DEVSERVER_URL")),
): DesktopAssetServer {
  const server = Deno.serve(async (request) => {
    const url = new URL(request.url)
    if (url.pathname === BRIDGE_PATH) return await serveBridge(request, bridge)
    if (frontendDevUrl) return redirectToDevServer(request, frontendDevUrl, desktopServerUrl())
    return await servePackagedAsset(request, backendConfig)
  })

  return {
    server,
    frontendBaseUrl: frontendDevUrl ?? desktopServerUrl(),
  }
}

function redirectToDevServer(request: Request, frontendDevUrl: string, bridgeBaseUrl: string): Response {
  const incoming = new URL(request.url)
  const target = new URL(incoming.pathname + incoming.search, ensureTrailingSlash(frontendDevUrl))
  target.searchParams.set("__xiranite_desktop_bridge", `${bridgeBaseUrl}${BRIDGE_PATH}`)
  return Response.redirect(target, 307)
}

async function serveBridge(request: Request, bridge: DesktopBridge): Promise<Response> {
  const headers = new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  })
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers })
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405, headers)

  try {
    const payload = await request.json() as { name?: unknown; args?: unknown }
    if (typeof payload.name !== "string" || !Array.isArray(payload.args)) {
      return json({ ok: false, error: "Invalid Deno Desktop bridge request." }, 400, headers)
    }
    return json({ ok: true, value: await bridge.dispatch(payload.name, payload.args) }, 200, headers)
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500, headers)
  }
}

async function servePackagedAsset(
  request: Request,
  backendConfig: DesktopBackendConfig | undefined,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 })
  }

  const url = new URL(request.url)
  const path = safeAssetPath(url.pathname)
  if (!path) {
    console.error(`[xiranite-desktop] rejected asset path: ${JSON.stringify(url.href)}`)
    return new Response("Invalid asset path", { status: 400 })
  }

  const requested = path === "" ? "index.html" : path
  const asset = await readAsset(requested)
  const resolved = asset ?? (requested.includes(".") ? undefined : await readAsset("index.html"))
  if (!resolved) return new Response("Not found", { status: 404 })

  let body = resolved.bytes
  if (resolved.path === "index.html") {
    const html = new TextDecoder().decode(body)
    body = new TextEncoder().encode(injectDesktopConfig(html, backendConfig))
  }

  const headers = new Headers({
    "content-type": contentType(resolved.path),
    "cache-control": resolved.path === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  })
  const responseBody = request.method === "HEAD" ? null : Uint8Array.from(body).buffer
  return new Response(responseBody, { headers })
}

async function readAsset(path: string): Promise<{ path: string; bytes: Uint8Array } | undefined> {
  try {
    return { path, bytes: await Deno.readFile(new URL(path, DIST_ROOT)) }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    throw error
  }
}

function safeAssetPath(pathname: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const relative = decoded.replace(/^\/+/, "")
  const segments = relative.split("/")
  if (segments.some((segment) => segment === ".." || segment.includes("\\"))) return undefined
  return segments.filter(Boolean).join("/")
}

function injectDesktopConfig(html: string, config: DesktopBackendConfig | undefined): string {
  const runtime = `<script>window.__XIRANITE_DESKTOP__={kind:"deno-desktop",version:1,bridgeUrl:${safeJSON(BRIDGE_PATH)}};</script>`
  const backend = config
    ? `<script>window.__XIRANITE_BACKEND__=${safeJSON(config)};</script>`
    : ""
  const injection = `${runtime}${backend}`
  return html.includes("<head>")
    ? html.replace("<head>", `<head>\n    ${injection}`)
    : `${injection}\n${html}`
}

function json(value: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(value), { status, headers })
}

function safeJSON(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

function desktopServerUrl(): string {
  const address = Deno.env.get("DENO_SERVE_ADDRESS")
  const port = address?.split(":").at(-1)
  if (!port) throw new Error("DENO_SERVE_ADDRESS is unavailable in the desktop runtime.")
  return `http://127.0.0.1:${port}`
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}

function contentType(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase()
  return ({
    avif: "image/avif",
    css: "text/css; charset=utf-8",
    gif: "image/gif",
    html: "text/html; charset=utf-8",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    map: "application/json; charset=utf-8",
    png: "image/png",
    svg: "image/svg+xml",
    wasm: "application/wasm",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream"
}

function clean(value: string | undefined): string | undefined {
  const next = value?.trim()
  return next || undefined
}
