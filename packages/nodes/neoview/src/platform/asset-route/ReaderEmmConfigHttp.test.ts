import { describe, expect, it, vi } from "vitest"

import type { NeoviewEmmConfig, NeoviewEmmPatch } from "../../application/config/ReaderRuntimeConfig.js"
import { ReaderHttpController } from "./ReaderHttpController.js"

const TOKEN = "emm-config-token"
const INITIAL: NeoviewEmmConfig = {
  enabled: true,
  databasePaths: ["D:/EMM/database.sqlite"],
  settingPath: "D:/EMM/setting.json",
  translationDatabasePath: "D:/EMM/translations.db",
  translationPath: "D:/EMM/db.text.json",
  defaultRating: 4.2,
}

describe("Reader EMM config HTTP", () => {
  it("[neoview.emm-config.http] authenticates and serializes strict EMM config updates", async () => {
    const updateEmm = vi.fn(async (patch: NeoviewEmmPatch, _tomlPatch: Record<string, unknown>) => ({
      ...INITIAL,
      ...patch.emm,
    }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: TOKEN,
      progressStore: false,
      emm: INITIAL,
      updateEmm,
    })
    const readOnly = new ReaderHttpController({ baseUrl: "http://127.0.0.1:41000", token: TOKEN, progressStore: false })
    const failing = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: TOKEN,
      progressStore: false,
      emm: INITIAL,
      updateEmm: async () => { throw new Error("config disk unavailable") },
    })
    try {
      expect((await controller.handle(request("GET", false)))?.status).toBe(401)
      await expect((await controller.handle(request("GET")))?.json()).resolves.toMatchObject({ emm: INITIAL })

      const patch = {
        emm: {
          enabled: false,
          databasePaths: ["D:/EMM/database.sqlite", "E:/Alt/database.sqlite"],
          settingPath: "",
          translationDatabasePath: "E:/EMM/translations.db",
          translationPath: "E:/EMM/db.text.json",
          defaultRating: 4.5,
        },
      }
      const updated = await controller.handle(request("PATCH", true, patch))
      expect(updated?.status).toBe(200)
      const updatedBody = await updated?.json() as { emm?: Record<string, unknown> }
      expect(updatedBody).toMatchObject({ emm: {
        enabled: false,
        databasePaths: ["D:/EMM/database.sqlite", "E:/Alt/database.sqlite"],
        translationDatabasePath: "E:/EMM/translations.db",
        translationPath: "E:/EMM/db.text.json",
        defaultRating: 4.5,
      } })
      expect(updatedBody.emm).not.toHaveProperty("settingPath")
      expect(updateEmm).toHaveBeenCalledWith(
        { emm: { ...patch.emm, settingPath: undefined } },
        { emm: {
          enabled: false,
          database_paths: ["D:/EMM/database.sqlite", "E:/Alt/database.sqlite"],
          setting_path: "",
          translation_database_path: "E:/EMM/translations.db",
          translation_path: "E:/EMM/db.text.json",
          default_rating: 4.5,
        } },
      )

      expect((await controller.handle(request("PATCH", true, { emm: { defaultRating: 6 } })))?.status).toBe(400)
      expect((await readOnly.handle(request("PATCH", true, { emm: { enabled: false } })))?.status).toBe(405)
      const failed = await failing.handle(request("PATCH", true, { emm: { enabled: false } }))
      expect(failed?.status).toBe(500)
      await expect(failed?.json()).resolves.toEqual({ error: "config disk unavailable" })
    } finally {
      await controller[Symbol.asyncDispose]()
      await readOnly[Symbol.asyncDispose]()
      await failing[Symbol.asyncDispose]()
    }
  })

  it("[neoview.emm-config.connection] exposes an authenticated strict connection probe", async () => {
    const probeEmm = vi.fn(async (config: NeoviewEmmConfig) => ({
      enabled: config.enabled,
      automatic: config.databasePaths.length === 0,
      connected: true,
      readOnly: true as const,
      sources: config.databasePaths.map((path) => ({ path, status: "compatible" as const, readOnly: true as const })),
    }))
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: TOKEN,
      progressStore: false,
      emm: INITIAL,
      probeEmm,
    })
    try {
      const unauthorized = await controller.handle(new Request("http://127.0.0.1:41000/reader/emm/config/probe", { method: "POST" }))
      expect(unauthorized?.status).toBe(401)
      const response = await controller.handle(new Request("http://127.0.0.1:41000/reader/emm/config/probe", {
        method: "POST",
        headers: { "x-xiranite-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ emm: { databasePaths: ["E:/Next/database.sqlite"] } }),
      }))
      expect(response?.status).toBe(200)
      await expect(response?.json()).resolves.toMatchObject({ connected: true, readOnly: true })
      expect(probeEmm).toHaveBeenCalledWith({ ...INITIAL, databasePaths: ["E:/Next/database.sqlite"] })

      const invalid = await controller.handle(new Request("http://127.0.0.1:41000/reader/emm/config/probe", {
        method: "POST",
        headers: { "x-xiranite-token": TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ emm: { databasePaths: Array.from({ length: 9 }, (_, index) => `D:/${index}.sqlite`) } }),
      }))
      expect(invalid?.status).toBe(400)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.emm-config.http-serialization] serializes concurrent config writes", async () => {
    const first = Promise.withResolvers<NeoviewEmmConfig>()
    const updateEmm = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ...INITIAL, defaultRating: 4.8 })
    const controller = new ReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: TOKEN,
      progressStore: false,
      emm: INITIAL,
      updateEmm,
    })
    try {
      const firstResponse = controller.handle(request("PATCH", true, { emm: { defaultRating: 4.4 } }))
      const secondResponse = controller.handle(request("PATCH", true, { emm: { defaultRating: 4.8 } }))
      await vi.waitFor(() => expect(updateEmm).toHaveBeenCalledTimes(1))
      first.resolve({ ...INITIAL, defaultRating: 4.4 })
      expect((await firstResponse)?.status).toBe(200)
      expect((await secondResponse)?.status).toBe(200)
      expect(updateEmm).toHaveBeenCalledTimes(2)
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function request(method: "GET" | "PATCH", authorized = true, body?: unknown): Request {
  return new Request("http://127.0.0.1:41000/reader/config", {
    method,
    headers: {
      ...(authorized ? { "x-xiranite-token": TOKEN } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
