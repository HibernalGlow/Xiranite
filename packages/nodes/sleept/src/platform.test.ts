import { describe, expect, test } from "vitest"
import { hostCapabilities, MAX_SLEEP_MS_PER_CALL } from "@xiranite/host-capabilities"
import { POWER_MODE_VALUES } from "./core.js"
import { createNodeSleeptRuntime, isLoopbackInterface, POWER_ACTIONS, sumInterfaceCounters } from "./platform.js"

describe("Sleept waits on the host clock", () => {
  /**
   * The claim is *which* mechanism waits, not merely that time passed: a local `setTimeout` also produces a
   * 700 ms pause and would pass any elapsed-time assertion, while it is undefined inside the realm (measured
   * by `target/debug/quickjs-run` on this bundle — see `docs/migration/sleept-host-lift-handoff.md`). So the
   * surface is stubbed and the test asserts the request reached it. Reverting `sleep` to a timer leaves the
   * recorder untouched and turns this red.
   */
  test("the runtime's sleep is the surface's clock.sleep", async () => {
    const requested: number[] = []
    const original = hostCapabilities.clock.sleep
    hostCapabilities.clock.sleep = async (milliseconds) => {
      requested.push(milliseconds)
      return milliseconds
    }
    try {
      const runtime = createNodeSleeptRuntime()
      await expect(runtime.sleep(700)).resolves.toBeUndefined()
    } finally {
      hostCapabilities.clock.sleep = original
    }
    expect(requested).toEqual([700])
  })

  /**
   * `tickCountdown` spends one tick per second of the countdown and asks for exactly
   * {@link MAX_SLEEP_MS_PER_CALL}, so the boundary is what keeps a long timer running: too small and the
   * countdown drifts long, over the cap and the transport refuses the call instead of waiting.
   */
  test("the tick the core asks for is one call, and one over it is refused", async () => {
    const started = Date.now()
    await expect(hostCapabilities.clock.sleep(MAX_SLEEP_MS_PER_CALL)).resolves.toBe(MAX_SLEEP_MS_PER_CALL)
    const waited = Date.now() - started
    expect(waited).toBeGreaterThanOrEqual(MAX_SLEEP_MS_PER_CALL - 20)
    await expect(hostCapabilities.clock.sleep(MAX_SLEEP_MS_PER_CALL + 1)).rejects.toThrow("may not exceed")
  })
})

describe("Sleept asks the power service in the product's own words", () => {
  /**
   * The node no longer owns any power command — the host answers `power.request` and this table is the only
   * thing between the operator's word and the host's. Two failures are pinned here: a mode mapped onto
   * another mode's action (which *works*, and only the machine knows the difference), and a mode renamed so
   * the host's refusal no longer says what was asked.
   */
  test("every mode has its own action, and restart is the only translation", () => {
    expect(POWER_ACTIONS).toMatchObject({
      sleep: "sleep",
      hibernate: "hibernate",
      shutdown: "shutdown",
      restart: "reboot",
      "display-sleep": "display-sleep",
      screensaver: "screensaver",
    })
    expect(Object.keys(POWER_ACTIONS).sort()).toEqual([...POWER_MODE_VALUES].sort())

    const actions = Object.values(POWER_ACTIONS)
    expect(new Set(actions).size, "no two modes may collapse onto one action").toBe(actions.length)
    expect(actions.filter((action) => action === "reboot")).toHaveLength(1)
  })

  /** `hibernate` is the mode macOS refuses; keeping its name is what makes the refusal attributable. */
  test("a refused mode is still named by the request that asked for it", () => {
    expect(POWER_ACTIONS.hibernate).toBe("hibernate")
    expect(POWER_ACTIONS.hibernate).not.toBe(POWER_ACTIONS.sleep)
  })
})

describe("Sleept reads traffic from the host's counters", () => {
  /**
   * Shaped from this machine's `os.net.counters` answer. The old `netstat -ibn` parser is gone, but the two
   * mistakes it was written to prevent are not: counting `lo0`'s ~22 GB of local traffic as machine traffic,
   * and letting one interface's rows be counted more than once. The host reports every interface it knows.
   */
  const HOST_INTERFACES = [
    { name: "lo0", receivedTotal: 999_999, transmittedTotal: 999_999 },
    { name: "en0", receivedTotal: 106_066_174_426, transmittedTotal: 163_637_997_940 },
    { name: "gif0", receivedTotal: 0, transmittedTotal: 0 },
    { name: "bridge0", receivedTotal: 1_024, transmittedTotal: 2_048 },
  ]

  test("loopback is excluded and every other interface counts once", () => {
    expect(sumInterfaceCounters(HOST_INTERFACES)).toEqual({
      bytesReceived: 106_066_174_426 + 1_024,
      bytesSent: 163_637_997_940 + 2_048,
    })
  })

  test("an answer with nothing in it is zero, not a guessed rate", () => {
    expect(sumInterfaceCounters([])).toEqual({ bytesSent: 0, bytesReceived: 0 })
  })

  test("loopback is recognised by the names the platforms actually use", () => {
    for (const name of ["lo", "lo0", "lo1", "Loopback"]) expect(isLoopbackInterface(name), name).toBe(true)
    for (const name of ["en0", "eth0", "wlan0", "bridge0", "utun4", "gif0"]) expect(isLoopbackInterface(name), name).toBe(false)
  })

  /**
   * The reading the CPU monitor refuses to guess at. `getCpuPercent` used to answer `null` because the host's
   * `os.cpus` carried no per-cpu `times` (ADR-0079 gap ④); `os.cpu.usage` answers a figure over a stated
   * window, so an unanswerable metric now travels as a failed call rather than a value the run could mistake
   * for an idle machine.
   */
  test("the CPU reading is the host's busy figure, and a missing one is an error", async () => {
    const original = hostCapabilities.service.invoke
    try {
      hostCapabilities.service.invoke = async () => ({ busyPercent: 41.5, perCore: [41.5], windowMs: 40 })
      await expect(createNodeSleeptRuntime().getCpuPercent()).resolves.toBe(41.5)

      hostCapabilities.service.invoke = async () => ({ windowMs: 40 })
      await expect(createNodeSleeptRuntime().getCpuPercent()).rejects.toThrow("busyPercent")
    } finally {
      hostCapabilities.service.invoke = original
    }
  })
})
