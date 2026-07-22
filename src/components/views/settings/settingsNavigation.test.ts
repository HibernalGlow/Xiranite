// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"

import {
  filterSettingsMatches,
  parseSettingsSectionId,
  scrollToSettingsMatch,
  scrollToSettingsStage,
  scrollToSettingsStep,
} from "./settingsNavigation"
import { SETTINGS_STAGES } from "./types"

const zhLabels: Record<string, string> = {
  "settings:sections.appearance": "外观",
  "settings:sections.workspace": "工作区",
  "settings:sections.view": "视图",
  "settings:sections.runtime": "运行时",
  "settings:sections.data": "数据",
  "settings:timeline.stageDesc.appearance": "主题、配色",
  "settings:timeline.stageDesc.workspace": "画布背景",
  "settings:timeline.stageDesc.view": "泳道交互",
  "settings:timeline.stageDesc.runtime": "本地后端",
  "settings:timeline.stageDesc.data": "数据库",
  "settings:timeline.steps.theme": "主题",
  "settings:timeline.steps.color": "颜色模式",
  "settings:timeline.steps.typography": "字体与语言",
  "settings:timeline.steps.atmosphere": "氛围效果",
  "settings:timeline.steps.themeImport": "导入主题 JSON",
  "settings:timeline.steps.background": "背景画布",
  "settings:timeline.steps.chrome": "操作栏",
  "settings:timeline.steps.alphabet": "字母索引",
  "settings:timeline.steps.swimlane": "泳道交互",
  "settings:timeline.steps.components": "组件皮肤",
  "settings:timeline.steps.cardInteraction": "卡片交互",
  "settings:timeline.steps.connection": "运行时连接",
  "settings:timeline.steps.webview2": "WebView2",
  "settings:timeline.steps.storage": "本地数据",
}

function t(key: string) {
  return zhLabels[key] ?? key
}

describe("settingsNavigation", () => {
  it("[settings.nav.parse] accepts known section ids and rejects unknown", () => {
    expect(parseSettingsSectionId("workspace")).toBe("workspace")
    expect(parseSettingsSectionId(" WORKSPACE ")).toBe("workspace")
    expect(parseSettingsSectionId("not-a-section")).toBeNull()
    expect(parseSettingsSectionId(null)).toBeNull()
    expect(parseSettingsSectionId("")).toBeNull()
  })

  it("[settings.nav.filter] matches stage and step labels from SETTINGS_STAGES", () => {
    const byWebview = filterSettingsMatches("webview", t)
    expect(byWebview.some((m) => m.kind === "step" && m.stepId === "webview2")).toBe(true)

    const byWorkspace = filterSettingsMatches("工作区", t)
    expect(byWorkspace.some((m) => m.kind === "stage" && m.sectionId === "workspace")).toBe(true)

    const bySwimlane = filterSettingsMatches("泳道", t)
    expect(bySwimlane.some((m) => m.kind === "step" && m.stepId === "swimlane")).toBe(true)

    expect(filterSettingsMatches("   ", t)).toEqual([])
    expect(filterSettingsMatches("zzzz-no-hit", t)).toEqual([])
  })

  it("[settings.nav.filter] covers every registered stage and step via its id", () => {
    for (const stage of SETTINGS_STAGES) {
      const stageHits = filterSettingsMatches(stage.id, t)
      expect(stageHits.some((m) => m.kind === "stage" && m.sectionId === stage.id)).toBe(true)
      for (const step of stage.steps) {
        const stepHits = filterSettingsMatches(step.id, t)
        expect(stepHits.some((m) => m.kind === "step" && m.stepId === step.id)).toBe(true)
      }
    }
  })

  it("[settings.nav.scroll] scrolls to real data-settings-step and data-timeline-entry anchors", () => {
    document.body.innerHTML = `
      <div data-settings-scroll>
        <section data-timeline-entry="workspace" id="workspace">
          <div data-settings-step="chrome" id="settings-step-chrome">chrome</div>
        </section>
      </div>
    `
    const root = document.querySelector("[data-settings-scroll]")
    const stage = document.querySelector<HTMLElement>('[data-timeline-entry="workspace"]')
    const step = document.querySelector<HTMLElement>('[data-settings-step="chrome"]')
    expect(stage && step && root).toBeTruthy()

    const stageSpy = vi.spyOn(stage!, "scrollIntoView")
    const stepSpy = vi.spyOn(step!, "scrollIntoView")

    expect(scrollToSettingsStage(root, "workspace", "auto")).toBe(true)
    expect(stageSpy).toHaveBeenCalledWith({ behavior: "auto", block: "start" })

    expect(scrollToSettingsStep(root, "chrome", "auto")).toBe(true)
    expect(stepSpy).toHaveBeenCalledWith({ behavior: "auto", block: "start" })

    expect(scrollToSettingsMatch(root, {
      kind: "step",
      sectionId: "workspace",
      stepId: "chrome",
      label: "操作栏",
      stageLabel: "工作区",
    }, "auto")).toBe(true)

    expect(scrollToSettingsStage(root, "runtime", "auto")).toBe(false)
    expect(scrollToSettingsStep(null, "chrome", "auto")).toBe(false)
  })
})
