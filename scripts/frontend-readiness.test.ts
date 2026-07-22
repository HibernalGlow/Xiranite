import { describe, expect, it } from "bun:test"

import { FRONTEND_READINESS_PATHS, waitForFrontendReady } from "./frontend-readiness"

describe("waitForFrontendReady", () => {
  it("waits for the complete application-shell probe set", async () => {
    const requested: string[] = []
    const methods: string[] = []

    await waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 1,
      stabilityDelayMs: 7,
      fetcher: (async (input, init) => {
        requested.push(String(input))
        methods.push(init?.method ?? "GET")
        return new Response(null, { status: 200 })
      }) as typeof fetch,
      sleep: async (milliseconds) => {
        expect(milliseconds).toBe(7)
      },
    })

    const expected = FRONTEND_READINESS_PATHS.map((path) => `http://127.0.0.1:5173${path}`)
    expect(requested).toEqual([...expected, ...expected])
    expect(methods).toEqual(["HEAD", "GET", "GET", "GET", "HEAD", "GET", "GET", "GET"])
  })

  it("retries when an application-shell module is not ready", async () => {
    let requests = 0
    let sleeps = 0

    await waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 2,
      delayMs: 5,
      stabilityDelayMs: 7,
      fetcher: (async () => {
        requests += 1
        const firstAttempt = requests <= FRONTEND_READINESS_PATHS.length
        return new Response(null, { status: firstAttempt ? 503 : 200 })
      }) as typeof fetch,
      sleep: async (milliseconds) => {
        expect([5, 7]).toContain(milliseconds)
        sleeps += 1
      },
    })

    expect(requests).toBe(FRONTEND_READINESS_PATHS.length * 3)
    expect(sleeps).toBe(2)
  })

  it("reports a bounded readiness timeout", async () => {
    await expect(waitForFrontendReady("http://127.0.0.1:5173", {
      attempts: 1,
      fetcher: (async () => new Response(null, { status: 503 })) as typeof fetch,
      sleep: async () => {},
    })).rejects.toThrow("rendered frontend module graph")
  })
})
