import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReaderEmmConfigDto, ReaderHttpClient } from "../../../adapters/reader-http-client"
import EmmConfigCard from "./EmmConfigCard"

afterEach(cleanup)

describe("EmmConfigCard", () => {
  it("[neoview.emm-config.lifecycle] performs no config work while hidden", () => {
    const client = { config: vi.fn() } as unknown as ReaderHttpClient
    render(<EmmConfigCard {...context(client, false)} />)
    expect(client.config).not.toHaveBeenCalled()
  })

  it("[neoview.emm-config.card] persists normalized external paths and supports automatic discovery reset", async () => {
    const initial: ReaderEmmConfigDto = { enabled: true, databasePaths: ["D:/EMM/database.sqlite"], defaultRating: 4.2 }
    const updateEmm = vi.fn(async ({ emm }: { emm: Partial<ReaderEmmConfigDto> }) => ({ ...initial, ...emm }))
    const client = { config: vi.fn(async () => ({ emm: initial })), updateEmm } as unknown as ReaderHttpClient
    render(<EmmConfigCard {...context(client)} />)
    const paths = await screen.findByRole("textbox", { name: "EMM 数据库路径" })
    fireEvent.change(paths, { target: { value: "D:\\EMM\\database.sqlite\nd:/emm/database.sqlite\nE:/Alt/database.sqlite" } })
    fireEvent.change(screen.getByRole("textbox", { name: "setting.json 路径" }), { target: { value: "D:/EMM/setting.json" } })
    fireEvent.change(screen.getByRole("textbox", { name: "translations.db 路径" }), { target: { value: "D:/EMM/translations.db" } })
    fireEvent.change(screen.getByRole("spinbutton", { name: "默认评分" }), { target: { value: "4.5" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(updateEmm).toHaveBeenCalledWith({ emm: {
      enabled: true,
      databasePaths: ["D:\\EMM\\database.sqlite", "E:/Alt/database.sqlite"],
      settingPath: "D:/EMM/setting.json",
      translationDatabasePath: "D:/EMM/translations.db",
      translationPath: undefined,
      defaultRating: 4.5,
    } }))
    expect((await screen.findByRole("status")).textContent).toContain("重新启动后生效")

    fireEvent.click(screen.getByRole("button", { name: "恢复自动发现" }))
    await waitFor(() => expect(updateEmm).toHaveBeenLastCalledWith({ emm: DEFAULT_CONFIG }))
  })
})

const DEFAULT_CONFIG: ReaderEmmConfigDto = { enabled: true, databasePaths: [], defaultRating: 4.2 }

function context(client: ReaderHttpClient, panelActive = true) {
  return { client, disabled: false, panelActive, onGoTo: vi.fn() }
}
