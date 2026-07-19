import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ReaderCardChromeProvider } from "../panels/ReaderCardChromeContext"
import { SettingsCardShell } from "./SettingsCardShell"

afterEach(cleanup)

describe("SettingsCardShell", () => {
  it("keeps its standalone title and icon", () => {
    render(<SettingsCardShell id="appearance" title="界面材质" icon={() => <span data-testid="icon" />}>content</SettingsCardShell>)

    expect(screen.getByRole("heading", { name: "界面材质" })).toBeTruthy()
    expect(screen.getByTestId("icon")).toBeTruthy()
  })

  it("removes the duplicate title but preserves embedded description and actions", () => {
    render(
      <ReaderCardChromeProvider value>
        <SettingsCardShell id="appearance" title="界面材质" description="材质说明" actions={<button type="button">重置</button>}>content</SettingsCardShell>
      </ReaderCardChromeProvider>,
    )

    expect(screen.queryByRole("heading", { name: "界面材质" })).toBeNull()
    expect(screen.getByText("材质说明")).toBeTruthy()
    expect(screen.getByRole("button", { name: "重置" })).toBeTruthy()
  })
})
