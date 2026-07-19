import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { DEFAULT_READER_BACKUP_SCHEDULE, parseReaderBackupScheduleConfig } from "./ReaderBackupScheduleConfig.js"

describe("Reader backup schedule config", () => {
  it("[neoview.settings.backup-schedule-config] defaults to disabled and resolves a portable backup directory", () => {
    expect(parseReaderBackupScheduleConfig(undefined, "D:/Xiranite")).toEqual(DEFAULT_READER_BACKUP_SCHEDULE)
    expect(parseReaderBackupScheduleConfig({
      enabled: true,
      directory: "backups/neoview",
      interval_hours: 12,
      retain_count: 4,
    }, "D:/Xiranite")).toEqual({
      enabled: true,
      directory: resolve("D:/Xiranite", "backups/neoview"),
      intervalHours: 12,
      retainCount: 4,
    })
  })

  it("[neoview.settings.backup-schedule-config-validation] requires an enabled schedule to have bounded settings", () => {
    expect(() => parseReaderBackupScheduleConfig({ enabled: true }, "D:/Xiranite")).toThrow("directory is required")
    expect(() => parseReaderBackupScheduleConfig({ enabled: true, directory: "backup", interval_hours: 2 }, "D:/Xiranite")).toThrow("between 6 and 720")
    expect(() => parseReaderBackupScheduleConfig({ enabled: true, directory: "backup", retain_count: 0 }, "D:/Xiranite")).toThrow("between 1 and 64")
  })
})
