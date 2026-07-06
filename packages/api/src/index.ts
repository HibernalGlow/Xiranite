import { Elysia } from "elysia"
import type { XiraniteServices } from "@xiranite/services"
import { createWorkspaceInputSchema, renameWorkspaceInputSchema, workspaceSnapshotSchema } from "@xiranite/shared"

export function createXiraniteApp(services: XiraniteServices) {
  return new Elysia({ name: "xiranite-api" })
    .get("/health", () => ({ ok: true }))
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
