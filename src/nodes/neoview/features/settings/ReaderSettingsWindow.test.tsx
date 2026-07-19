import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderShellConfigDto } from "../../adapters/reader-http-client"
import { DEFAULT_READER_RADIAL_MENU_CONFIG } from "@xiranite/node-neoview/ui-core"

vi.mock("./cards/PanelLayoutEditor", () => ({ default: () => <div data-testid="panel-layout-editor">editor</div> }))

import { ReaderSettingsWindow } from "./ReaderSettingsWindow"

afterEach(cleanup)

describe("ReaderSettingsWindow", () => {
  it("[neoview.settings.window] follows the standalone categorized settings fixture and defers Kanban", async () => {
    const save = vi.fn(async () => undefined)
    const saveViewDefaults = vi.fn(async () => undefined)
    render(
      <ReaderSettingsWindow
        shell={shell()}
        viewDefaults={{ fitMode: "fit", pageMode: "single" }}
        slideshow={{ intervalSeconds: 5, loop: false, random: false, fadeTransition: true }}
        media={media()}
        inputBindings={{ bindings: [] }}
        radialMenu={DEFAULT_READER_RADIAL_MENU_CONFIG}
        onClose={vi.fn()}
        onBoardLayout={save}
        onViewDefaults={saveViewDefaults}
        onSlideshow={vi.fn(async () => undefined)}
        onMedia={vi.fn(async () => media())}
        onInputBindings={vi.fn(async () => ({ bindings: [] }))}
        onRadialMenu={vi.fn(async () => DEFAULT_READER_RADIAL_MENU_CONFIG)}
        onLegacySettingsInspect={vi.fn(async () => ({ report: { fullyRecognized: true, summary: {}, entries: [] } }))}
        onLegacySettingsImport={vi.fn(async () => ({ report: { fullyRecognized: true, summary: {}, entries: [] }, strategy: "merge" as const }))}
        onMaterial={vi.fn(async () => shell())}
      />,
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy()
    expect(screen.getByRole("navigation", { name: "NeoView 设置分类" })).toBeTruthy()
    expect(await screen.findByRole("heading", { name: "边栏布局" })).toBeTruthy()
    expect(screen.queryByTestId("panel-layout-editor")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "保存边栏布局" }))
    expect(save).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: "卡片管理" }))
    expect(await screen.findByTestId("panel-layout-editor")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "视图" }))
    expect(await screen.findByRole("heading", { name: "视图默认值" })).toBeTruthy()
    fireEvent.change(screen.getByRole("combobox", { name: "默认缩放模式" }), { target: { value: "fit-width" } })
    expect(saveViewDefaults).toHaveBeenCalledWith({ fitMode: "fit-width" })

    fireEvent.click(screen.getByRole("button", { name: "外观" }))
    expect(await screen.findByRole("heading", { name: "界面材质" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "通用" }))
    expect(await screen.findByRole("heading", { name: "幻灯片" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "影像" }))
    expect(await screen.findByRole("heading", { name: "影像" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "数据" }))
    expect(await screen.findByRole("heading", { name: "数据迁移" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "关于" }))
    expect(await screen.findByRole("heading", { name: "关于 NeoView" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "系统" }))
    expect(await screen.findByRole("heading", { name: "系统" })).toBeTruthy()
    expect(screen.getByText(/排除路径/)).toBeTruthy()
  })
})

function media() {
  return {
    supportedImageFormats: ["jpg", "png", "webp"],
    videoFormats: ["mp4", "webm"],
    mediaMimeTypes: {},
    autoPlayAnimatedImages: true,
    animatedVideoEnabled: false,
    animatedVideoKeywords: ["[#dyna]"],
    videoMinPlaybackRate: 0.25,
    videoMaxPlaybackRate: 16,
    videoPlaybackRateStep: 0.25,
    subtitle: { fontSize: 18, color: "#ffffff", backgroundOpacity: 0.7, bottomPercent: 5 },
  }
}

function shell(): ReaderShellConfigDto {
  return {
    showDelayMs: 0,
    hideDelayMs: 0,
    opacity: { top: 85, bottom: 85, sidebar: 85 },
    blur: { top: 12, bottom: 12, sidebar: 12 },
    edges: {
      top: { enabled: true, initialVisible: true, pinned: false, triggerSize: 32 },
      right: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      bottom: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
      left: { enabled: true, initialVisible: false, pinned: false, triggerSize: 32 },
    },
    sidebars: {
      left: { width: 320, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
      right: { width: 280, height: "full", customHeight: 100, verticalAlign: 0, horizontalPosition: 0 },
    },
    panelLayout: {
      pageList: { visible: true, order: 0, position: "left" },
      info: { visible: true, order: 0, position: "right" },
    },
    cardLayout: {
      "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 0 },
      "book-information": { panelId: "info", visible: true, expanded: true, order: 0 },
    },
  }
}
