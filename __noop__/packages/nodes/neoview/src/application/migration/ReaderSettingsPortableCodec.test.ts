import { describe, expect, it } from "vitest"

import { ReaderSettingsPortableCodec } from "./ReaderSettingsPortableCodec.js"

describe("ReaderSettingsPortableCodec", () => {
  it("[neoview.settings.portable-roundtrip] preserves current config extensions while omitting sensitive values", () => {
    const codec = new ReaderSettingsPortableCodec()
    const payload = codec.encode({
      schema_version: 1,
      reader: { reading_direction: "right-to-left", future: { enabled: true } },
      integration: { api_token: "must-not-leak", nested: [{ password: "hidden", keep: 3 }] },
    }, 123)
    expect(payload).toEqual({
      format: "Xiranite/NeoViewConfig",
      version: 1,
      exportedAt: 123,
      nodeConfig: {
        schema_version: 1,
        reader: { reading_direction: "right-to-left", future: { enabled: true } },
        integration: { nested: [{ keep: 3 }] },
      },
      omittedSensitivePaths: ["integration.api_token", "integration.nested[0].password"],
    })
    expect(codec.decode(JSON.stringify(payload))).toEqual(payload)
    expect(JSON.stringify(payload)).not.toContain("must-not-leak")
  })

  it("[neoview.settings.portable-security] rejects sensitive, malformed and unbounded imported payloads", () => {
    const codec = new ReaderSettingsPortableCodec()
    expect(() => codec.decode({
      format: "Xiranite/NeoViewConfig", version: 1, exportedAt: 1,
      nodeConfig: { secret: "value" }, omittedSensitivePaths: [],
    })).toThrow("contain sensitive fields")
    expect(() => codec.decode({
      format: "Xiranite/NeoViewConfig", version: 2, exportedAt: 1,
      nodeConfig: {}, omittedSensitivePaths: [],
    })).toThrow()
    let nested: Record<string, unknown> = {}
    const root = nested
    for (let index = 0; index < 34; index += 1) nested = nested.next = {}
    expect(() => codec.encode(root)).toThrow("nesting levels")
  })
})
