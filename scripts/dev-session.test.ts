import { describe, expect, it } from "bun:test"

import { devSessionPath, devStopRequestPath } from "./dev-session"

describe("managed development session paths", () => {
  it("isolates state and stop requests by supervisor PID", () => {
    expect(devSessionPath(10)).not.toBe(devSessionPath(11))
    expect(devStopRequestPath(10)).not.toBe(devStopRequestPath(11))
    expect(devSessionPath(10)).toMatch(/xiranite-dev-sessions[\\/]10\.json$/)
    expect(devStopRequestPath(10)).toMatch(/xiranite-dev-sessions[\\/]10\.stop$/)
  })
})
