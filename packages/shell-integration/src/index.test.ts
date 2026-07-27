import { describe, expect, it } from "vitest"
import { buildWindowsShellCommand, legacyWindowsShellRegistryPath, quoteWindowsCommandArgument } from "./index.js"

describe("Windows Shell Integration", () => {
  it("quotes a desktop argv command without cmd interpolation", () => {
    expect(buildWindowsShellCommand("C:\\Program Files\\Xiranite\\Xiranite.exe", ["--launch-node", "neoview", "--", "%V"]))
      .toBe('"C:\\Program Files\\Xiranite\\Xiranite.exe" --launch-node neoview -- "%V"')
  })

  it("uses HKCU classes for legacy user registrations", () => {
    expect(legacyWindowsShellRegistryPath("HKCU", "Xiranite.NeoView.Open", "background"))
      .toBe("HKCU\\Software\\Classes\\Directory\\Background\\shell\\Xiranite.NeoView.Open")
  })

  it("escapes embedded quotes according to Windows argv rules", () => {
    expect(quoteWindowsCommandArgument('C:\\A "book"')).toBe('"C:\\A \\"book\\""')
  })
})
