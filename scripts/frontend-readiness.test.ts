import { describe, expect, it } from "bun:test"

import {
  FRONTEND_DESKTOP_PATHS,
  FRONTEND_LISTEN_PATHS,
  FRONTEND_SHELL_PATHS,
  pathsForReadinessProfile,
  waitForFrontendReady,
} from "./frontend-readiness"

describe("waitForFrontendReady", () => {
  it("uses the shell probe set by default", async () => {
    const requested: string[] = []
    const methods: string[] = []

    await waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 1,
      stabilityDelayMs: 7,
      fetcher: (async (input, init) => {
        requested.push(String(input))
        methods.push(init?.method ?? "GET")
        const path = new URL(String(input)).pathname
        const type = path === "/" ? "text/html" : "text/javascript"
        return new Response(null, { status: 200, headers: { "content-type": type } })
      }) as typeof fetch,
      sleep: async (milliseconds) => {
        expect(milliseconds).toBe(7)
      },
    })

    const expected = FRONTEND_SHELL_PATHS.map((path) => `http://127.0.0.1:5173${path}`)
    expect(requested).toEqual([...expected, ...expected])
    expect(methods).toEqual(["HEAD", "GET", "HEAD", "GET"])
  })

  it("supports a listen-only profile for fast browser open", async () => {
    const requested: string[] = []
    await waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 1,
      profile: "listen",
      stabilityDelayMs: 0,
      fetcher: (async (input) => {
        requested.push(String(input))
        return new Response(null, { status: 200, headers: { "content-type": "text/html" } })
      }) as typeof fetch,
      sleep: async () => {},
    })
    // Stability re-probe doubles the listen path once the first probe succeeds.
    const once = FRONTEND_LISTEN_PATHS.map((path) => `http://127.0.0.1:5173${path}`)
    expect(requested).toEqual([...once, ...once])
  })

  it("rejects SPA HTML fallback for module paths", async () => {
    await expect(waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 1,
      profile: "desktop",
      stabilityDelayMs: 0,
      fetcher: (async (input) => {
        const path = new URL(String(input)).pathname
        const type = path === "/" ? "text/html" : "text/html"
        return new Response("<!doctype html>", { status: 200, headers: { "content-type": type } })
      }) as typeof fetch,
      sleep: async () => {},
    })).rejects.toThrow("rendered frontend module graph")
  })

  it("retries when an application-shell module is not ready", async () => {
    let requests = 0
    let sleeps = 0

    await waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 2,
      delayMs: 5,
      stabilityDelayMs: 7,
      fetcher: (async (input) => {
        requests += 1
        const path = new URL(String(input)).pathname
        const firstAttempt = requests <= FRONTEND_SHELL_PATHS.length
        const type = path === "/" ? "text/html" : "text/javascript"
        return new Response(null, {
          status: firstAttempt && path !== "/" ? 503 : 200,
          headers: { "content-type": type },
        })
      }) as typeof fetch,
      sleep: async (milliseconds) => {
        expect([5, 7]).toContain(milliseconds)
        sleeps += 1
      },
    })

    expect(requests).toBe(FRONTEND_SHELL_PATHS.length * 3)
    expect(sleeps).toBe(2)
  })

  it("maps readiness profiles to path sets", () => {
    expect(pathsForReadinessProfile("listen")).toEqual(FRONTEND_LISTEN_PATHS)
    expect(pathsForReadinessProfile("shell")).toEqual(FRONTEND_SHELL_PATHS)
    expect(pathsForReadinessProfile("desktop")).toEqual(FRONTEND_DESKTOP_PATHS)
  })
})
