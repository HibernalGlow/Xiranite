import { describe, expect, it } from "vitest"
import { parseArgs } from "./cli.js"

describe("BATONG CLI", () => {
  it("parses documented conversion arguments and JSON output", () => {
    expect(parseArgs(["convert", "--from", "codex", "--to=claude", "session.jsonl", "--latest", "--import", "--json"])).toEqual({
      json: true,
      input: {
        action: "convert",
        from: "codex",
        to: "claude",
        sessionPath: "session.jsonl",
        latest: true,
        import: true,
        rawArgs: ["convert", "--from", "codex", "--to=claude", "session.jsonl", "--latest", "--import"],
      },
    })
  })

  it("passes non-conversion commands through to Baton", () => {
    expect(parseArgs(["doctor", "--verbose"])).toEqual({
      json: false,
      input: { action: "doctor", rawArgs: ["doctor", "--verbose"] },
    })
  })
})
