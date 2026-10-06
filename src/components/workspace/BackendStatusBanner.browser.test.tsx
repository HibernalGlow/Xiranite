import { page } from "vitest/browser"
import { afterEach, expect, test, vi } from "vitest"
import { render } from "vitest-browser-react"
import { BackendStatusBanner } from "./BackendStatusBanner"

const statusQuery = vi.hoisted(() => ({
  data: {
    status: "missing-config" as const,
    error: "Set window.__XIRANITE_BACKEND__ or VITE_XIRANITE_BACKEND_URL.",
    runtime: {
      hostRuntime: "wails" as const,
      frontendSource: "packaged" as const,
      frontendOrigin: "http://wails.localhost",
      backendTokenConfigured: false,
      devAttachCommand: "bun run dev:desktop:attach",
      devStartCommand: "bun run dev:desktop",
      hotSwitchSupported: false as const,
    },
  },
  isFetching: false,
  refetch: vi.fn(),
}))

const workspaceActions = vi.hoisted(() => ({ setOverlay: vi.fn() }))

vi.mock("@/hooks/useLocalBackendStatus", () => ({
  useLocalBackendStatus: () => statusQuery,
}))

vi.mock("@/store/workspaceStore", () => ({
  useWorkspaceActions: () => workspaceActions,
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      const messages: Record<string, string> = {
        "settings:backendBanner.missingConfig": "Local Backend is not configured, so workspace and node execution are paused.",
        "settings:backendBanner.hostReason": `Local Backend could not start: ${values?.reason ?? "unknown"}`,
        "settings:backendBanner.unreachable": `Local Backend is unreachable: ${values?.url ?? "unknown"}. Workspace and node execution are paused.`,
        "settings:backendBanner.retry": "Retry",
        "settings:backendBanner.copyDiagnostics": "Copy diagnostics",
        "settings:backendBanner.diagnosticsCopied": "Diagnostics copied",
        "settings:backendBanner.diagnosticsCopyFailed": "Copy diagnostics failed",
        "settings:backendBanner.openRuntime": "Runtime settings",
        "settings:developerRuntime.statusChecking": "Checking",
        "common:unknown": "unknown",
      }
      return messages[key] ?? key
    },
  }),
}))

afterEach(() => {
  delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard
  statusQuery.refetch.mockReset()
  workspaceActions.setOverlay.mockReset()
  vi.restoreAllMocks()
})

test("shows the host startup reason instead of a generic dead end", async () => {
  const previousError = statusQuery.data.error
  statusQuery.data.error = "this package has no embedded Bun runtime; install Bun 1.3 or later, or set XIRANITE_BUN_BIN: exec: \"bun\" not found"

  try {
    await render(<BackendStatusBanner />)

    const banner = page.getByRole("status")
    await expect.element(banner).toHaveTextContent("Local Backend could not start: this package has no embedded Bun runtime")
  } finally {
    statusQuery.data.error = previousError
  }
})

test("copies backend failure diagnostics without exposing the backend token", async () => {
  const writeText = vi.fn(async (_value: string) => undefined)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })

  await render(<BackendStatusBanner />)

  const copyButton = page.getByRole("button", { name: /复制诊断信息|Copy diagnostics/ })
  await expect.element(copyButton).toBeVisible()
  await copyButton.click()
  await expect.element(page.getByRole("button", { name: /诊断信息已复制|Diagnostics copied/ })).toBeVisible()

  expect(writeText).toHaveBeenCalledTimes(1)
  const diagnostics = writeText.mock.calls[0]?.[0] ?? ""
  expect(diagnostics).toContain("status=missing-config")
  expect(diagnostics).toContain("Set window.__XIRANITE_BACKEND__")
  expect(diagnostics).not.toContain("token")
})
