import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "bun:test"

import {
  BACKEND_GATEWAY_PATH_PREFIX,
  backendConfigBootstrapScript,
  backendGatewayPublicUrl,
  backendGatewayTargetUrl,
  backendGatewayTargetPath,
  isBackendGatewayPath,
  readBackendGatewayTarget,
  writeBackendGatewayTarget,
} from "./backend-gateway"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function runBootstrapScript(bootstrap: string, href: string): { baseUrl: string; token?: string } {
  const location = new URL(href)
  const sandbox: { location: { protocol: string; host: string }; __XIRANITE_BACKEND__?: { baseUrl: string; token?: string } } = {
    location: { protocol: location.protocol, host: location.host },
  }
  new Function("window", bootstrap)(sandbox)
  if (!sandbox.__XIRANITE_BACKEND__) throw new Error("bootstrap did not publish window.__XIRANITE_BACKEND__")
  return sandbox.__XIRANITE_BACKEND__
}

describe("backend gateway", () => {
  it("owns one reserved backend namespace and leaves every legacy or asset path to the frontend", () => {
    expect(isBackendGatewayPath(`${BACKEND_GATEWAY_PATH_PREFIX}/reader/s/1/page/2`)).toBe(true)
    expect(isBackendGatewayPath(`${BACKEND_GATEWAY_PATH_PREFIX}/future-capability`)).toBe(true)
    expect(isBackendGatewayPath(BACKEND_GATEWAY_PATH_PREFIX)).toBe(true)
    expect(isBackendGatewayPath("/reader/s/1/page/2")).toBe(false)
    expect(isBackendGatewayPath("/file-deletions")).toBe(false)
    expect(isBackendGatewayPath("/config/webview2-flags.json")).toBe(false)
    expect(isBackendGatewayPath("/src/main.tsx")).toBe(false)
    expect(isBackendGatewayPath("/wails/runtime")).toBe(false)
    expect(isBackendGatewayPath("/assets/app.js")).toBe(false)
  })

  it("builds and strips the public namespace without losing escaped paths or queries", () => {
    expect(backendGatewayPublicUrl("http://127.0.0.1:5173/ignored?stale=1")).toBe(
      "http://127.0.0.1:5173/_xiranite/backend",
    )
    expect(backendGatewayTargetUrl(
      "/_xiranite/backend/file-deletions/id%2F1/restore?token=secret",
      "http://127.0.0.1:43123/internal",
    )?.href).toBe("http://127.0.0.1:43123/internal/file-deletions/id%2F1/restore?token=secret")
    expect(backendGatewayTargetUrl("/assets/app.js", "http://127.0.0.1:43123")).toBeUndefined()
  })

  it("injects a gateway URL on the document origin, not the Vite origin", () => {
    const bootstrap = backendConfigBootstrapScript("secret")

    // The desktop window renders from the custom `wails://` asset origin. That
    // scheme is not special, so `window.location.origin` would be the string
    // "null"; the bootstrap must key off protocol + host instead.
    expect(runBootstrapScript(bootstrap, "wails://localhost:5173/index.html")).toEqual({
      baseUrl: `wails://localhost:5173${BACKEND_GATEWAY_PATH_PREFIX}`,
      token: "secret",
    })
    expect(runBootstrapScript(bootstrap, "http://127.0.0.1:5173/")).toEqual({
      baseUrl: `http://127.0.0.1:5173${BACKEND_GATEWAY_PATH_PREFIX}`,
      token: "secret",
    })
    expect(runBootstrapScript(bootstrap, "http://wails.localhost:5173/deep/link")).toEqual({
      baseUrl: `http://wails.localhost:5173${BACKEND_GATEWAY_PATH_PREFIX}`,
      token: "secret",
    })
    expect(bootstrap).not.toContain("location.origin")
  })

  it("injects without a token when the gateway runs unauthenticated and never breaks out of the script element", () => {
    expect(runBootstrapScript(backendConfigBootstrapScript(undefined), "http://127.0.0.1:5173/")).toEqual({
      baseUrl: `http://127.0.0.1:5173${BACKEND_GATEWAY_PATH_PREFIX}`,
    })
    const escaped = backendConfigBootstrapScript("</script><script>alert(1)")
    expect(escaped).not.toContain("</script>")
    expect(runBootstrapScript(escaped, "http://127.0.0.1:5173/").token).toBe("</script><script>alert(1)")
  })

  it("stores internal targets outside the public directory and validates reads", async () => {
    const path = backendGatewayTargetPath("http://127.0.0.1:5173")
    expect(path).toMatch(/\.cache[\\/]backend-gateway[\\/]target-5173\.json$/)

    const directory = await mkdtemp(join(tmpdir(), "xiranite-gateway-"))
    temporaryDirectories.push(directory)
    const targetPath = join(directory, "target.json")
    await Bun.write(targetPath, JSON.stringify({ baseUrl: "http://127.0.0.1:43123", token: "secret" }))
    await expect(readBackendGatewayTarget(targetPath)).resolves.toEqual({
      baseUrl: "http://127.0.0.1:43123",
      token: "secret",
    })
  })

  it("atomically replaces a managed target", async () => {
    const frontendUrl = `http://127.0.0.1:${62_000 + Math.floor(Math.random() * 1_000)}`
    await writeBackendGatewayTarget({ baseUrl: "http://127.0.0.1:43124", token: "first" }, frontendUrl)
    await writeBackendGatewayTarget({ baseUrl: "http://127.0.0.1:43125", token: "second" }, frontendUrl)
    const path = backendGatewayTargetPath(frontendUrl)
    await expect(readBackendGatewayTarget(path)).resolves.toEqual({
      baseUrl: "http://127.0.0.1:43125",
      token: "second",
    })
    await rm(path, { force: true })
  })
})
