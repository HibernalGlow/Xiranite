import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterEach, expect, test } from "vitest"

import {
  WindowsReaderExplorerContextMenuProvider,
  type RegistryCommandResult,
} from "./WindowsReaderExplorerContextMenuProvider.js"

const execFileAsync = promisify(execFile)
const testOnWindows = process.platform === "win32" ? test : test.skip
const testSuffix = `${process.pid}-${Date.now().toString(36)}`
const entryKey = `Xiranite.NeoView.Open.Test-${testSuffix}`
const extension = `xiranite-launch-${testSuffix}`
const testRegistryPaths = [
  `HKCU\\Software\\Classes\\SystemFileAssociations\\.${extension}\\shell\\${entryKey}`,
  `HKCU\\Software\\Classes\\Directory\\shell\\${entryKey}`,
  `HKCU\\Software\\Classes\\Directory\\Background\\shell\\${entryKey}`,
]

afterEach(async () => {
  await Promise.all(testRegistryPaths.map(async (path) => { await runReg(["delete", path, "/f"]) }))
})

testOnWindows("[neoview.file.explorer-context-menu.windows] registers exact owned values through HKCU and reads them through merged HKCR", async () => {
  const provider = createProvider()
  const preview = await provider.preview()
  expect(preview.available).toBe(true)
  expect(preview.plan).toHaveLength(3)

  await expect(provider.setEnabled(true)).resolves.toEqual({ available: true, enabled: true, state: "registered" })
  for (const item of preview.plan) {
    const mergedPath = item.registryPath.replace("HKCU\\Software\\Classes\\", "HKCR\\")
    await expectRegistryValue(mergedPath, "", item.label)
    await expectRegistryValue(mergedPath, "Icon", item.icon)
    await expectRegistryValue(mergedPath, "Xiranite.ManagedBy", "xiranite.shell-integration/v1")
    await expectRegistryValue(mergedPath, "Xiranite.NodeId", "neoview")
    await expectRegistryValue(mergedPath, "Xiranite.Intent", "open")
    await expectRegistryValue(mergedPath, "Xiranite.RegistrationId", "xiranite.neoview.open")
    await expectRegistryValue(`${mergedPath}\\command`, "", item.command)
  }
  await expect(provider.setEnabled(false)).resolves.toEqual({ available: true, enabled: false, state: "disabled" })
  for (const path of testRegistryPaths) {
    const result = await runReg(["query", path])
    expect(result.code).not.toBe(0)
  }
}, 60_000)

testOnWindows("[neoview.file.explorer-context-menu.windows] reports an external same-name key as a conflict without deleting it", async () => {
  const provider = createProvider()
  await expect(runReg(["add", testRegistryPaths[0]!, "/ve", "/d", "External registration", "/f"])).resolves.toMatchObject({ code: 0 })

  await expect(provider.status()).resolves.toMatchObject({ available: true, enabled: false, state: "conflict" })
  await expectRegistryValue(testRegistryPaths[0]!, "", "External registration")
}, 60_000)

function createProvider(): WindowsReaderExplorerContextMenuProvider {
  return new WindowsReaderExplorerContextMenuProvider({
    platform: "win32",
    registration: {
      key: entryKey,
      label: "Open with NeoView test",
      executable: process.execPath,
      arguments: ["--launch-node", "neoview", "--intent", "open", "--source", "explorer", "--", "%1"],
      scopes: ["file", "directory", "background"],
      extensions: [extension],
      hives: ["HKCU"],
    },
  })
}

async function expectRegistryValue(path: string, value: string, expected: string): Promise<void> {
  const result = await runReg(["query", path, ...(value ? ["/v", value] : ["/ve"])])
  expect(result.code).toBe(0)
  expect(`${result.stdout}\n${result.stderr}`).toContain(expected)
}

async function runReg(args: readonly string[]): Promise<RegistryCommandResult> {
  try {
    const result = await execFileAsync("reg.exe", [...args], { windowsHide: true, encoding: "utf8" })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
    }
  }
}
