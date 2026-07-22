import { describe, expect, it } from "bun:test"

import {
  FRONTEND_LISTEN_PATHS,
  FRONTEND_SHELL_PATHS,
  formatFrontendReadyLog,
  formatFrontendWaitLog,
  waitForFrontendReady,
} from "./frontend-readiness"

describe("waitForFrontendReady", () => {
  it("defaults to the lightweight listen probe set and reports timing", async () => {
    const requested: string[] = []
    const methods: string[] = []
    const sinceMs = Date.now() - 1_000

    const result = await waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 1,
      stabilityDelayMs: 7,
      sinceMs,
      fetcher: (async (input, init) => {
        requested.push(String(input))
        methods.push(init?.method ?? "GET")
        return new Response(null, { status: 200 })
      }) as typeof fetch,
      sleep: async (milliseconds) => {
        expect(milliseconds).toBe(7)
      },
    })

    const expected = FRONTEND_LISTEN_PATHS.map((path) => `http://127.0.0.1:5173${path}`)
    expect(requested).toEqual([...expected, ...expected])
    expect(methods).toEqual(["HEAD", "GET", "HEAD", "GET"])
    expect(result.mode).toBe("listen")
    expect(result.attemptsUsed).toBe(1)
    expect(result.probesSucceeded).toBe(2)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.sinceStartMs).toBeGreaterThanOrEqual(1_000)
    expect(formatFrontendReadyLog(result)).toContain("probe=")
    expect(formatFrontendReadyLog(result)).toContain("since-start=")
    expect(formatFrontendWaitLog("http://127.0.0.1:5173", { profile: "listen" })).toContain("mode=listen")
  })

  it("can probe the full desktop shell graph", async () => {
    const requested: string[] = []

    const result = await waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 1,
      mode: "shell",
      stabilityDelayMs: 0,
      fetcher: (async (input) => {
        requested.push(String(input))
        return new Response(null, { status: 200 })
      }) as typeof fetch,
      sleep: async () => {},
    })

    expect(result.mode).toBe("shell")
    expect(requested).toEqual([
      ...FRONTEND_SHELL_PATHS.map((path) => `http://127.0.0.1:5173${path}`),
      ...FRONTEND_SHELL_PATHS.map((path) => `http://127.0.0.1:5173${path}`),
    ])
  })

  it("retries when an entry module is not ready", async () => {
    let requests = 0
    let sleeps = 0

    const result = await waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 2,
      delayMs: 5,
      stabilityDelayMs: 7,
      fetcher: (async () => {
        requests += 1
        const firstAttempt = requests <= FRONTEND_LISTEN_PATHS.length
        return new Response(null, { status: firstAttempt ? 503 : 200 })
      }) as typeof fetch,
      sleep: async (milliseconds) => {
        expect([5, 7]).toContain(milliseconds)
        sleeps += 1
      },
    })

    expect(result.attemptsUsed).toBe(2)
    expect(requests).toBe(FRONTEND_LISTEN_PATHS.length * 3)
    expect(sleeps).toBe(2)
  })

  it("reports a bounded readiness timeout with elapsed time", async () => {
    await expect(waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 1,
      fetcher: (async () => new Response(null, { status: 503 })) as typeof fetch,
      sleep: async () => {},
    })).rejects.toThrow(/frontend \(listen\) after \d+ms/)
  })
})
