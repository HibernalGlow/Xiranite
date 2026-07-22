import { describe, expect, it } from "vitest"
import { LOCAL_BACKEND_READY_REFETCH_MS } from "./useLocalBackendStatus"

describe("local backend status polling", () => {
  it("refreshes the dev backend manifest within the restart handoff window", () => {
    expect(LOCAL_BACKEND_READY_REFETCH_MS).toBe(1_000)
  })
})
