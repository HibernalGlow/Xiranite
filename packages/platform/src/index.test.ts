import { describe, expect, test } from "vitest"

import {
  appDirectoryName,
  createPlatformContext,
  isSupportedPlatform,
  nativeLibraryPathVariable,
  nativePlatformKey,
  openPathCommand,
  pathEntryEquals,
  pathListSeparator,
  prependPathEntry,
  resolveAppCacheDir,
  resolveAppConfigDir,
  resolveAppDataDir,
  resolveAppLogDir,
  resolveAppStateDir,
  sharedLibraryExtension,
} from "./index.js"

const HOME = "/home/tester"

function ctx(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}, arch = "x64") {
  return { platform, arch, env, homeDir: HOME }
}

describe("platform context", () => {
  test("defaults to the real environment and can be overridden", () => {
    const resolved = createPlatformContext({ platform: "linux", homeDir: HOME, env: {} })
    expect(resolved.platform).toBe("linux")
    expect(resolved.homeDir).toBe(HOME)
  })

  test("only win32/darwin/linux are supported", () => {
    expect(isSupportedPlatform(ctx("win32"))).toBe(true)
    expect(isSupportedPlatform(ctx("darwin"))).toBe(true)
    expect(isSupportedPlatform(ctx("linux"))).toBe(true)
    expect(isSupportedPlatform(ctx("freebsd" as NodeJS.Platform))).toBe(false)
  })
})

describe("app directory naming", () => {
  test("uses the product name on Windows/macOS and lower-case on Linux", () => {
    expect(appDirectoryName(ctx("win32"))).toBe("Xiranite")
    expect(appDirectoryName(ctx("darwin"))).toBe("Xiranite")
    expect(appDirectoryName(ctx("linux"))).toBe("xiranite")
  })
})

describe("data directory", () => {
  test("Windows prefers LOCALAPPDATA then APPDATA then home fallback", () => {
    expect(resolveAppDataDir(ctx("win32", { LOCALAPPDATA: "C:/Users/t/AppData/Local", APPDATA: "C:/Users/t/AppData/Roaming" })))
      .toBe("C:/Users/t/AppData/Local/Xiranite")
    expect(resolveAppDataDir(ctx("win32", { APPDATA: "C:/Users/t/AppData/Roaming" })))
      .toBe("C:/Users/t/AppData/Roaming/Xiranite")
    expect(resolveAppDataDir(ctx("win32", {})))
      .toBe("/home/tester/AppData/Local/Xiranite")
  })

  test("macOS uses Application Support", () => {
    expect(resolveAppDataDir(ctx("darwin", {}))).toBe("/home/tester/Library/Application Support/Xiranite")
  })

  test("Linux honours XDG_DATA_HOME and falls back to ~/.local/share", () => {
    expect(resolveAppDataDir(ctx("linux", { XDG_DATA_HOME: "/xdg/data" }))).toBe("/xdg/data/xiranite")
    expect(resolveAppDataDir(ctx("linux", {}))).toBe("/home/tester/.local/share/xiranite")
  })
})

describe("config/cache/state/log directories", () => {
  test("Windows config prefers APPDATA, others use XDG_CONFIG_HOME", () => {
    expect(resolveAppConfigDir(ctx("win32", { APPDATA: "C:/Roaming" }))).toBe("C:/Roaming")
    expect(resolveAppConfigDir(ctx("win32", {}))).toBe("/home/tester/.config")
    expect(resolveAppConfigDir(ctx("linux", { XDG_CONFIG_HOME: "/xdg/cfg" }))).toBe("/xdg/cfg")
    expect(resolveAppConfigDir(ctx("darwin", {}))).toBe("/home/tester/.config")
  })

  test("cache never lands in ~/.cache on macOS", () => {
    expect(resolveAppCacheDir(ctx("win32", { LOCALAPPDATA: "C:/Local" }))).toBe("C:/Local/Xiranite")
    expect(resolveAppCacheDir(ctx("darwin", {}))).toBe("/home/tester/Library/Caches/Xiranite")
    expect(resolveAppCacheDir(ctx("linux", { XDG_CACHE_HOME: "/xdg/cache" }))).toBe("/xdg/cache/xiranite")
  })

  test("state root per OS", () => {
    expect(resolveAppStateDir(ctx("win32", { LOCALAPPDATA: "C:/Local" }))).toBe("C:/Local/Xiranite")
    expect(resolveAppStateDir(ctx("darwin", {}))).toBe("/home/tester/Library/Application Support/Xiranite")
    expect(resolveAppStateDir(ctx("linux", {}))).toBe("/home/tester/.local/state/xiranite")
  })

  test("log directory per OS", () => {
    expect(resolveAppLogDir(ctx("win32", { LOCALAPPDATA: "C:/Local" }))).toBe("C:/Local/Xiranite/logs")
    expect(resolveAppLogDir(ctx("darwin", {}))).toBe("/home/tester/Library/Logs/Xiranite")
    expect(resolveAppLogDir(ctx("linux", {}))).toBe("/home/tester/.local/state/xiranite/logs")
  })
})

describe("native library conventions", () => {
  test("platform key combines platform and arch", () => {
    expect(nativePlatformKey(ctx("darwin", {}, "arm64"))).toBe("darwin-arm64")
    expect(nativePlatformKey(ctx("win32", {}, "x64"))).toBe("win32-x64")
  })

  test("shared library extension per OS", () => {
    expect(sharedLibraryExtension(ctx("win32"))).toBe(".dll")
    expect(sharedLibraryExtension(ctx("darwin"))).toBe(".dylib")
    expect(sharedLibraryExtension(ctx("linux"))).toBe(".so")
  })

  test("native library search variable per OS", () => {
    expect(nativeLibraryPathVariable(ctx("win32"))).toBe("PATH")
    expect(nativeLibraryPathVariable(ctx("darwin"))).toBe("DYLD_LIBRARY_PATH")
    expect(nativeLibraryPathVariable(ctx("linux"))).toBe("LD_LIBRARY_PATH")
  })
})

describe("path list handling", () => {
  test("separator is ';' on Windows and ':' elsewhere", () => {
    expect(pathListSeparator(ctx("win32"))).toBe(";")
    expect(pathListSeparator(ctx("linux"))).toBe(":")
  })

  test("Windows comparison is case-insensitive, POSIX is exact", () => {
    expect(pathEntryEquals("C:\\Lib", "c:\\lib", ctx("win32"))).toBe(true)
    expect(pathEntryEquals("/Lib", "/lib", ctx("linux"))).toBe(false)
  })

  test("prepend adds missing entries and skips duplicates", () => {
    expect(prependPathEntry("/usr/lib", "/opt/lib", ctx("linux"))).toBe("/opt/lib:/usr/lib")
    expect(prependPathEntry("/opt/lib:/usr/lib", "/opt/lib", ctx("linux"))).toBe("/opt/lib:/usr/lib")
    expect(prependPathEntry(undefined, "/opt/lib", ctx("linux"))).toBe("/opt/lib")
    expect(prependPathEntry("C:\\Lib", "c:\\lib", ctx("win32"))).toBe("C:\\Lib")
  })
})

describe("open path command", () => {
  test("per-OS file manager command", () => {
    expect(openPathCommand("/tmp/x", ctx("win32")).command).toBe("explorer.exe")
    expect(openPathCommand("/tmp/x", ctx("darwin")).command).toBe("open")
    expect(openPathCommand("/tmp/x", ctx("linux")).command).toBe("xdg-open")
    expect(openPathCommand("/tmp/x", ctx("linux")).args).toEqual(["/tmp/x"])
  })
})
