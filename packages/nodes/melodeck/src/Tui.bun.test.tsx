/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { describe, expect, test } from "bun:test"
import { createMelodeckInteractionSchema } from "./interaction.js"
import { MelodeckTui } from "./Tui.js"

describe("Melodeck OpenTUI screen", () => {
  test("renders queue and playback controls", async () => {
    const setup = await testRender(<MelodeckTui definition={{ schema: createMelodeckInteractionSchema({ paths: "D:/Music/demo.flac" }, "en"), run: async () => ({ success: true, message: "Ready", data: { command: [], status: { running: true, paused: false, path: "demo.flac", title: "Demo", duration: 120, position: 10, volume: 80, playlist: ["D:/Music/demo.flac"] }, output: "", errors: [] } }) }} language="en" onExit={() => undefined} />, { width: 128, height: 34, useMouse: true })
    try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("MELODECK // LOCAL MUSIC DECK"); expect(frame).toContain("QUEUE"); expect(frame).toContain("NOW PLAYING"); expect(frame).toContain("D:/Music/demo.flac") } finally { await act(async () => setup.renderer.destroy()) }
  })
})
