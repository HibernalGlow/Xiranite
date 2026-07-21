import { describe, expect, it, vi } from "vitest"
import { DEFAULT_READER_VOICE_CONTROL_CONFIG, type NeoviewVoiceControlPatch } from "../../application/config/ReaderVoiceControlConfig.js"
import { ReaderHttpController } from "./ReaderHttpController.js"

describe("Reader voice control HTTP", () => {
  it("[neoview.voice-control.http] validates and persists an independent shallow TOML patch", async () => {
    const updateVoiceControl = vi.fn(async (patch: NeoviewVoiceControlPatch) => ({ ...DEFAULT_READER_VOICE_CONTROL_CONFIG, ...patch.voiceControl }))
    const controller = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: "reader-token", updateVoiceControl })
    try {
      const response = await controller.handle(request({ voiceControl: { enabled: true, language: "ja-JP", commands: { "reader.next-page": ["次へ"] } } }))
      expect(response?.status).toBe(200)
      await expect(response!.json()).resolves.toMatchObject({ voiceControl: { enabled: true, language: "ja-JP" } })
      expect(updateVoiceControl).toHaveBeenCalledWith(
        { voiceControl: { enabled: true, language: "ja-JP", commands: { "reader.next-page": ["次へ"] } } },
        { voice_control: { enabled: true, language: "ja-JP", commands: { "reader.next-page": ["次へ"] } } },
      )
      expect((await controller.handle(request({ voiceControl: { minConfidence: 2 } })))?.status).toBe(400)
    } finally { await controller[Symbol.asyncDispose]() }
  })
})

function request(body: unknown): Request {
  return new Request("http://127.0.0.1:41000/reader/config", { method: "PATCH", headers: { "content-type": "application/json", "x-xiranite-token": "reader-token" }, body: JSON.stringify(body) })
}
