import { describe, expect, test } from "vitest"
import { hostCapabilities, MAX_SLEEP_MS_PER_CALL } from "@xiranite/host-capabilities"
import { POWER_MODE_VALUES } from "./core.js"
import { createNodeSleeptRuntime, parseMacInterfaceCounters, resolvePowerCommand } from "./platform.js"

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

describe("Sleept platform power commands", () => {
  test("maps Windows hibernate to shutdown /h", () => {
    expect(resolvePowerCommand("win32", "hibernate")).toEqual({
      executable: "shutdown",
      args: ["/h"],
    })
  })

  test("does not silently replace macOS hibernate with sleep", () => {
    expect(resolvePowerCommand("darwin", "hibernate")).toBeUndefined()
  })
})

/** Shaped by hand from this machine's `netstat -ibn`: `lo0` has no address column on its link row, `en0`
 * repeats its counters on three rows, and `gif0*` is an interface that never came up. */
const MAC_INTERFACE_SAMPLE = [
  "Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll",
  "lo0        16384 <Link#1>                      1000     0 999999 1000     0 999999     0",
  "lo0        16384 127           127.0.0.1       1000     - 999999 1000     - 999999     -",
  "en0        1500  <Link#11>   ce:96:8d:e8:9f:05 154112883     0 106066174426 156854536     0 163637997940     0",
  "en0        1500  fe80::10fb: fe80:b::10fb:48c8 154112883     - 106066174426 156854536     - 163637997940     -",
  "en0        1500  192.168.3     192.168.3.32    154112883     - 106066174426 156854536     - 163637997940     -",
  "gif0*      1280  <Link#2>                             0     0          0        0     0          0     0",
  "bridge0    1500  <Link#12>   36:86:59:ce:f6:c0        7     0       1024        9     0       2048     0",
].join("\n")

describe("Sleept macOS interface counters", () => {
  test("counts every interface once and ignores loopback", () => {
    // Summing all `en0` rows would report three times 106066174426; summing `lo0` would add its 999999.
    expect(parseMacInterfaceCounters(MAC_INTERFACE_SAMPLE)).toEqual({
      bytesReceived: 106066174426 + 1024,
      bytesSent: 163637997940 + 2048,
    })
  })

  test("answers zero for output it cannot read instead of guessing a column", () => {
    expect(parseMacInterfaceCounters("")).toEqual({ bytesSent: 0, bytesReceived: 0 })
    expect(parseMacInterfaceCounters("en0 1500 <Link#11> ce:96:8d:e8:9f:05 1")).toEqual({ bytesSent: 0, bytesReceived: 0 })
  })
})

describe("Sleept session-level power commands", () => {
  test("macOS uses the two arms measured on this machine as an ordinary user", () => {
    expect(resolvePowerCommand("darwin", "display-sleep")).toEqual({ executable: "pmset", args: ["displaysleepnow"] })
    expect(resolvePowerCommand("darwin", "screensaver")).toEqual({ executable: "open", args: ["-a", "ScreenSaverEngine"] })
  })

  test("Windows broadcasts one WM_SYSCOMMAND, with the parameter that differs actually differing", () => {
    const off = resolvePowerCommand("win32", "display-sleep")
    const saver = resolvePowerCommand("win32", "screensaver")

    expect(off?.executable).toBe("powershell.exe")
    expect(off?.args.join(" ")).toContain("[Xiranite.SessionPower]::SendMessage(-1,0x0112,0xF170,2)")
    expect(saver?.args.join(" ")).toContain("[Xiranite.SessionPower]::SendMessage(-1,0x0112,0xF140,0)")
    expect(off?.args).not.toEqual(saver?.args)
  })

  /**
   * The failure this pins is the quiet one: a table edit that points 显示器休眠 at the machine-sleep command,
   * or the saver at the panel-off one. Both still "work", and only the user's screen knows the difference.
   */
  test("no two modes collapse onto the same command on any platform", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
      const byCommand = new Map<string, string>()
      for (const mode of POWER_MODE_VALUES) {
        const command = resolvePowerCommand(platform, mode)
        if (!command) continue
        const key = `${command.executable} ${command.args.join(" ")}`
        const previous = byCommand.get(key)
        expect(previous, `${platform}: ${mode} is the same command as ${previous}`).toBeUndefined()
        byCommand.set(key, mode)
      }
      // macOS refuses hibernate, so it answers five of six; both other platforms answer all six.
      expect(byCommand.size).toBe(platform === "darwin" ? POWER_MODE_VALUES.length - 1 : POWER_MODE_VALUES.length)
    }
  })

  test("a mode the platform refuses is named, not substituted", () => {
    expect(resolvePowerCommand("darwin", "hibernate")).toBeUndefined()
    expect(resolvePowerCommand("darwin", "sleep")).toBeDefined()
  })
})
