// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { DataMigrationSettingsCard } from "./DataMigrationSettingsCard"

const backend = vi.hoisted(() => ({
  get: vi.fn(async () => ({ config: { shell: { accent: "#22c55e" }, input_bindings: { bindings: [] } }, path: "D:/xiranite.config.toml" })),
  export: vi.fn(async () => ({ content: '[nodes.neoview.shell]\naccent = "#22c55e"\n', filename: "neoview.config.toml", mimeType: "application/toml" })),
}))

vi.mock("@/backend/configRpcClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/backend/configRpcClient")>(),
  getNodeConfigFromBackend: backend.get,
  exportNodeConfigFromBackend: backend.export,
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("DataMigrationSettingsCard", () => {
  test("opens directly into the embedded config center without opening a dialog", async () => {
    render(<DataMigrationSettingsCard />)

    expect(await screen.findByRole("tab", { name: "当前配置" })).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByRole("tab", { name: "变更历史" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "导入 / 导出" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "备份 / 同步" })).toBeTruthy()
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "返回概览" }))
    await waitFor(() => expect(screen.queryByRole("tab", { name: "变更历史" })).toBeNull())
    expect(screen.getByText("界面与布局")).toBeTruthy()
  })
})
