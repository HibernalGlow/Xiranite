import { treaty, type Treaty } from "@elysiajs/eden"
import { Elysia } from "elysia"
import type { XiraniteServices } from "@xiranite/services"
import { createWorkspaceInputSchema, renameWorkspaceInputSchema } from "@xiranite/shared"

export function createXiraniteApp(services: XiraniteServices) {
  return new Elysia({ name: "xiranite-api" })
    .get("/health", () => ({ ok: true }))
    .get("/workspace", async () => {
      const workspaces = await services.workspace.listWorkspaces()
      return { workspaces }
    })
    .post("/workspace", async ({ body, set }) => {
      const parsed = createWorkspaceInputSchema.safeParse(body)
      if (!parsed.success) {
        set.status = 400
        return { error: parsed.error.flatten() }
      }

      const workspace = await services.workspace.createWorkspace(parsed.data)
      set.status = 201
      return { workspace }
    })
    .post("/workspace/:id/rename", async ({ body, params, set }) => {
      const parsed = renameWorkspaceInputSchema.safeParse(body)
      if (!parsed.success) {
        set.status = 400
        return { error: parsed.error.flatten() }
      }

      const workspace = await services.workspace.renameWorkspace(params.id, parsed.data)
      return { workspace }
    })
    .delete("/workspace/:id", async ({ params }) => {
      await services.workspace.deleteWorkspace(params.id)
      return { ok: true }
    })
}

export type XiraniteApp = ReturnType<typeof createXiraniteApp>

export function createXiraniteClient(baseUrl: string): Treaty.Create<XiraniteApp> {
  return treaty<XiraniteApp>(baseUrl)
}
