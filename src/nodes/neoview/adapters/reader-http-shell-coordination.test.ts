import { afterEach, expect, it, vi } from "vitest"

import { createReaderHttpClient } from "./reader-http-client"

afterEach(() => vi.unstubAllGlobals())

it("[neoview.shell.revision-client] coordinates writes across clients and backend generations", async () => {
  let revision = 7
  let instanceId = "backend-instance-1"
  const rejectedRevisions: number[] = []
  const fetchMock = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== "PATCH") return Response.json({ shell: { revision } })
    const body = JSON.parse(String(init.body)) as { expectedRevision?: number }
    if (body.expectedRevision !== revision) {
      rejectedRevisions.push(body.expectedRevision ?? -1)
      return Response.json({ error: "revision conflict", shell: { revision } }, { status: 409 })
    }
    revision += 1
    return Response.json({ shell: { revision } })
  })
  vi.stubGlobal("fetch", fetchMock)
  const resolveConfig = () => ({ baseUrl: "http://127.0.0.1:41009", token: "revision-test", instanceId })
  const first = createReaderHttpClient(resolveConfig)
  const second = createReaderHttpClient(resolveConfig)

  await expect(Promise.all([
    first.updateShellControl!({ expectedRevision: 0, shellControl: { floating: { enabled: true } } }),
    second.updateBoardLayout({ expectedRevision: 0, board: { panels: [], cards: [] } }),
  ])).resolves.toEqual([{ revision: 8 }, { revision: 9 }])
  expect(rejectedRevisions).toEqual([])
  expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PATCH", "PATCH"])
  expect(fetchMock.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body)).expectedRevision)).toEqual([7, 8])

  revision = 0
  instanceId = "backend-instance-2"
  await expect(first.updateShellControl!({ expectedRevision: 9, shellControl: { floating: { enabled: false } } })).resolves.toEqual({ revision: 1 })
  expect(rejectedRevisions).toEqual([])
  expect(fetchMock.mock.calls.slice(3).map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PATCH"])
  expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body)).expectedRevision).toBe(0)
})
