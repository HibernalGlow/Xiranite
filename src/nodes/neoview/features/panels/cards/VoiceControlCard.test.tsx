import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import VoiceControlCard from "./VoiceControlCard"

class Recognition {
  static latest: Recognition | undefined
  continuous = false; interimResults = false; lang = ""
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }>> }) => void) | null = null
  onerror = null; onend = null
  constructor() { Recognition.latest = this }
  start() {}
  stop() {}
}

describe("VoiceControlCard", () => {
  it("dispatches recognized commands through the shared input action callback", () => {
    Object.assign(globalThis, { SpeechRecognition: Recognition })
    const onInputAction = vi.fn()
    const onVoiceControl = vi.fn(async (patch) => ({ enabled: patch.enabled ?? false, language: "zh-CN", minConfidence: 0.6, continuous: false, commands: {} }))
    render(<VoiceControlCard client={{} as never} disabled={false} panelActive onInputAction={onInputAction} onVoiceControl={onVoiceControl} voiceControl={{ enabled: true, language: "zh-CN", minConfidence: 0.6, continuous: false, commands: {} }} onGoTo={vi.fn()}/>)
    fireEvent.click(screen.getByRole("switch")); fireEvent.click(screen.getByText("开始监听"))
    Recognition.latest?.onresult?.({ results: [[{ transcript: "下一页" }]] })
    expect(onInputAction).toHaveBeenCalledWith("reader.next-page")
    delete (globalThis as { SpeechRecognition?: unknown }).SpeechRecognition
  })
})
