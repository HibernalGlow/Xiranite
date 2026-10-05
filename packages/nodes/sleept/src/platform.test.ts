import { describe, expect, test } from "vitest"
import { parseMacInterfaceCounters, resolvePowerCommand } from "./platform.js"

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
