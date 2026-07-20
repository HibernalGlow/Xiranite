import { describe, expect, it } from "vitest"
import { LegacyEmmDataLocator } from "./LegacyEmmDataLocator.js"

describe("LegacyEmmDataLocator", () => {
  it("[neoview.emm.external-locator] finds the actual EMM database.sqlite and related files under APPDATA", () => {
    const existing = new Set([
      "D:\\Users\\reader\\AppData\\Roaming\\exhentai-manga-manager\\database.sqlite",
      "D:\\Users\\reader\\AppData\\Roaming\\exhentai-manga-manager\\setting.json",
      "D:\\Users\\reader\\AppData\\Roaming\\exhentai-manga-manager\\db.text.json",
    ])
    expect(new LegacyEmmDataLocator().locate({
      platform: "win32",
      env: { APPDATA: "D:\\Users\\reader\\AppData\\Roaming" },
      homeDir: "D:\\Users\\reader",
      cwd: "D:\\NeoView",
      fileExists: (path) => existing.has(path),
    })).toEqual({
      databasePaths: ["D:\\Users\\reader\\AppData\\Roaming\\exhentai-manga-manager\\database.sqlite"],
      settingPath: "D:\\Users\\reader\\AppData\\Roaming\\exhentai-manga-manager\\setting.json",
      translationDatabasePath: undefined,
      translationDictionaryPath: "D:\\Users\\reader\\AppData\\Roaming\\exhentai-manga-manager\\db.text.json",
    })
  })

  it("[neoview.emm.external-locator-legacy] discovers portable and local legacy db.sqlite layouts", () => {
    const existing = new Set([
      "D:\\NeoView\\portable\\db.sqlite",
      "D:\\Users\\reader\\AppData\\Local\\exhentai-manga-manager\\db.sqlite",
      "D:\\Users\\reader\\AppData\\Local\\exhentai-manga-manager\\setting.json",
      "D:\\Users\\reader\\AppData\\Local\\exhentai-manga-manager\\translations.db",
    ])
    expect(new LegacyEmmDataLocator().locate({
      platform: "win32",
      env: {
        APPDATA: "D:\\Users\\reader\\AppData\\Roaming",
        LOCALAPPDATA: "D:\\Users\\reader\\AppData\\Local",
      },
      homeDir: "D:\\Users\\reader",
      cwd: "D:\\NeoView",
      fileExists: (path) => existing.has(path),
    })).toEqual({
      databasePaths: [
        "D:\\NeoView\\portable\\db.sqlite",
        "D:\\Users\\reader\\AppData\\Local\\exhentai-manga-manager\\db.sqlite",
      ],
      settingPath: "D:\\Users\\reader\\AppData\\Local\\exhentai-manga-manager\\setting.json",
      translationDatabasePath: "D:\\Users\\reader\\AppData\\Local\\exhentai-manga-manager\\translations.db",
      translationDictionaryPath: undefined,
    })
  })

  it("[neoview.emm.external-locator-config] uses configured database paths without falling back to unrelated candidates", () => {
    expect(new LegacyEmmDataLocator().locate({
      platform: "win32",
      env: { APPDATA: "C:\\AppData" },
      databasePaths: [" D:\\EMM\\main.sqlite "],
      fileExists: (path) => path === "D:\\EMM\\main.sqlite",
    }).databasePaths).toEqual(["D:\\EMM\\main.sqlite"])
  })
})
