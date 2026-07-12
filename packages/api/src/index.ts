import { Elysia, t } from "elysia"
import type { XiraniteServices } from "@xiranite/services"
import {
  createWorkspaceInputSchema,
  nodeRunHistoryClearQuerySchema,
  nodeRunHistoryQuerySchema,
  nodeRunRequestSchema,
  renameWorkspaceInputSchema,
  runtimeHistoryClearQuerySchema,
  runtimeHistoryQuerySchema,
  workspaceSnapshotSchema,
  type NodeOperationStreamMessageDTO,
  type NodeRunEventDTO,
} from "@xiranite/shared"

export function createXiraniteApp(services: XiraniteServices) {
  return new Elysia({ name: "xiranite-api" })
    .get("/health", () => ({ ok: true }))
    .post("/system/restart", async ({ set }) => {
      const restartBackend = services.system?.restartBackend
      if (!restartBackend) {
        set.status = 501
        return {
          restarted: false,
          supported: false,
          message: "Local backend restart is not supported by this runtime.",
        }
      }
      return await restartBackend()
    })
    .post("/nodes/:id/operations", ({ body, params }) => {
      const operation = services.nodes.startOperation(params.id, body.input, body.context)
      return { operation }
    }, {
      body: nodeRunRequestSchema,
    })
    .post("/nodes/:id/run", async ({ body, params }) => {
      const events: NodeRunEventDTO[] = []
      const result = await services.nodes.runNode(params.id, body.input, (event) => {
        events.push(event)
      }, body.context)
      return { result, events }
    }, {
      body: nodeRunRequestSchema,
    })
    .delete("/node-operations", ({ query }) => {
      return services.nodes.cleanupOperations({
        maxAgeMs: parseOptionalInteger(query.maxAgeMs),
      })
    })
    .get("/node-operations", ({ query }) => {
      return services.nodes.listOperations({
        nodeId: query.nodeId || undefined,
        activeOnly: query.activeOnly === "true",
        limit: parseOptionalInteger(query.limit),
      })
    })
    .get("/node-operations/:operationId/events", ({ params, query, set }) => {
      const events = services.nodes.getOperationEvents(params.operationId, {
        fromEventIndex: parseEventIndex(query.from),
        limit: parseOptionalInteger(query.limit),
      })
      if (!events) {
        set.status = 404
        return { error: "Node operation not found." }
      }
      return events
    })
    .post("/node-operations/:operationId/cancel", ({ params, set }) => {
      const operation = services.nodes.cancelOperation(params.operationId)
      if (!operation) {
        set.status = 404
        return { error: "Node operation not found." }
      }
      return { operation }
    })
    .post("/node-operations/:operationId/pause", ({ params, set }) => {
      const operation = services.nodes.pauseOperation(params.operationId)
      if (!operation) { set.status = 404; return { error: "Node operation not found." } }
      return { operation }
    })
    .post("/node-operations/:operationId/resume", ({ params, set }) => {
      const operation = services.nodes.resumeOperation(params.operationId)
      if (!operation) { set.status = 404; return { error: "Node operation not found." } }
      return { operation }
    })
    .get("/node-operations/:operationId/stream", ({ params, query, set }) => {
      const operation = services.nodes.getOperation(params.operationId)
      if (!operation) {
        set.status = 404
        return { error: "Node operation not found." }
      }

      const fromEventIndex = parseEventIndex(query.from)
      return createNodeOperationStream(services, params.operationId, fromEventIndex)
    })
    .get("/node-operations/:operationId", ({ params, set }) => {
      const operation = services.nodes.getOperation(params.operationId)
      if (!operation) {
        set.status = 404
        return { error: "Node operation not found." }
      }
      return { operation }
    })
    .get("/workspace", async () => {
      const workspaces = await services.workspace.listWorkspaces()
      return { workspaces }
    })
    .get("/workspace/snapshot", async () => {
      const snapshot = await services.workspace.getSnapshot()
      return { snapshot }
    })
    .put("/workspace/snapshot", async ({ body }) => {
      const snapshot = await services.workspace.saveSnapshot(body)
      return { snapshot }
    }, {
      body: workspaceSnapshotSchema,
    })
    .post("/workspace", async ({ body, set }) => {
      const workspace = await services.workspace.createWorkspace(body)
      set.status = 201
      return { workspace }
    }, {
      body: createWorkspaceInputSchema,
    })
    .post("/workspace/:id/rename", async ({ body, params }) => {
      const workspace = await services.workspace.renameWorkspace(params.id, body)
      return { workspace }
    }, {
      body: renameWorkspaceInputSchema,
    })
    .delete("/workspace/:id", async ({ params }) => {
      await services.workspace.deleteWorkspace(params.id)
      return { ok: true }
    })
    .get("/runtime-history", async ({ query, set }) => {
      if (!services.history) {
        set.status = 503
        return { error: "Runtime history is not available." }
      }
      const parsed = runtimeHistoryQuerySchema.parse(query)
      return await services.history.listRuntime(parsed)
    })
    .get("/runtime-history/:id", async ({ params, set }) => {
      if (!services.history) {
        set.status = 503
        return { error: "Runtime history is not available." }
      }
      const item = await services.history.getRuntime(params.id)
      if (!item) {
        set.status = 404
        return { error: "History item not found." }
      }
      return { item }
    })
    .delete("/runtime-history/:id", async ({ params, set }) => {
      if (!services.history) {
        set.status = 503
        return { error: "Runtime history is not available." }
      }
      await services.history.deleteRuntime(params.id)
      return { ok: true }
    })
    .delete("/runtime-history", async ({ query, set }) => {
      if (!services.history) {
        set.status = 503
        return { error: "Runtime history is not available." }
      }
      const parsed = runtimeHistoryClearQuerySchema.parse(query)
      return await services.history.clearRuntime(parsed)
    })
    .get("/node-run-history", async ({ query, set }) => {
      if (!services.history) {
        set.status = 503
        return { error: "Node run history is not available." }
      }
      const parsed = nodeRunHistoryQuerySchema.parse(query)
      return await services.history.list(parsed)
    })
    .get("/node-run-history/:id", async ({ params, set }) => {
      if (!services.history) {
        set.status = 503
        return { error: "Node run history is not available." }
      }
      const item = await services.history.get(params.id)
      if (!item) {
        set.status = 404
        return { error: "History item not found." }
      }
      return { item }
    })
    .delete("/node-run-history/:id", async ({ params, set }) => {
      if (!services.history) {
        set.status = 503
        return { error: "Node run history is not available." }
      }
      await services.history.delete(params.id)
      return { ok: true }
    })
    .delete("/node-run-history", async ({ query, set }) => {
      if (!services.history) {
        set.status = 503
        return { error: "Node run history is not available." }
      }
      const parsed = nodeRunHistoryClearQuerySchema.parse(query)
      return await services.history.clear(parsed)
    })
    .get("/config", async () => {
      const result = await services.config.getConfig()
      return result
    })
    .get("/config/path", () => {
      return { path: services.config.getConfigPath() }
    })
    .post("/config/open", async () => {
      return await services.config.openConfigFile()
    })
    .get("/config/nodes/:nodeId", async ({ params }) => {
      return await services.config.getNodeConfig(params.nodeId)
    })
    .put("/config/nodes/:nodeId", async ({ body, params }) => {
      const { config } = body as { config: unknown }
      return await services.config.updateNodeConfig(params.nodeId, config)
    }, {
      body: t.Object({
        config: t.Any(),
      }),
    })
    .get("/config/app/:section", async ({ params }) => {
      return await services.config.getAppConfig(params.section)
    })
    .put("/config/app/:section", async ({ body, params }) => {
      const { config } = body as { config: unknown }
      return await services.config.updateAppConfig(params.section, config)
    }, {
      body: t.Object({
        config: t.Any(),
      }),
    })
    .get("/config/themes", async () => {
      return await services.config.getCustomThemes()
    })
    .put("/config/themes", async ({ body }) => {
      const { themes } = body as { themes: unknown[] }
      return await services.config.saveCustomThemes(themes)
    }, {
      body: t.Object({
        themes: t.Array(t.Any()),
      }),
    })
    .get("/config/bg-image", async () => {
      return await services.config.getBackgroundImage()
    })
    .put("/config/bg-image", async ({ body }) => {
      const { url } = body as { url: string | null }
      return await services.config.saveBackgroundImage(url)
    }, {
      body: t.Object({
        url: t.Union([t.String(), t.Null()]),
      }),
    })
    .post("/config/import-legacy", async ({ body }) => {
      const { legacyPath, nodeId } = body as { legacyPath: string; nodeId: string }
      return await services.config.importLegacy(legacyPath, nodeId)
    }, {
      body: t.Object({
        legacyPath: t.String(),
        nodeId: t.String(),
      }),
    })
}

export type XiraniteApp = ReturnType<typeof createXiraniteApp>

function parseEventIndex(value: unknown): number {
  if (typeof value !== "string" || value.trim() === "") return 0
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function createNodeOperationStream(services: XiraniteServices, operationId: string, fromEventIndex: number): Response {
  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe()
        controller.close()
      }

      const write = (message: NodeOperationStreamMessageDTO) => {
        if (closed) return
        controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`))
        if (message.type === "result") queueMicrotask(close)
      }

      unsubscribe = services.nodes.subscribeOperation(operationId, write, {
        fromEventIndex,
        includeSnapshot: true,
      })
    },
    cancel() {
      closed = true
      unsubscribe()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
