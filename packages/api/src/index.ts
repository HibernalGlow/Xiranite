import { Elysia } from "elysia"
import type { XiraniteServices } from "@xiranite/services"
import {
  createWorkspaceInputSchema,
  nodeRunRequestSchema,
  renameWorkspaceInputSchema,
  workspaceSnapshotSchema,
  type NodeOperationStreamMessageDTO,
  type NodeRunEventDTO,
} from "@xiranite/shared"

export function createXiraniteApp(services: XiraniteServices) {
  return new Elysia({ name: "xiranite-api" })
    .get("/health", () => ({ ok: true }))
    .post("/nodes/:id/operations", ({ body, params }) => {
      const operation = services.nodes.startOperation(params.id, body.input)
      return { operation }
    }, {
      body: nodeRunRequestSchema,
    })
    .post("/nodes/:id/run", async ({ body, params }) => {
      const events: NodeRunEventDTO[] = []
      const result = await services.nodes.runNode(params.id, body.input, (event) => {
        events.push(event)
      })
      return { result, events }
    }, {
      body: nodeRunRequestSchema,
    })
    .delete("/node-operations", ({ query }) => {
      return services.nodes.cleanupOperations({
        maxAgeMs: parseOptionalInteger(query.maxAgeMs),
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
