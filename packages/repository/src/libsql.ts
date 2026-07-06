import { createClient, type Client } from "@libsql/client"
import { asc, eq, inArray, not } from "drizzle-orm"
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql"
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { ComponentDTO, LaneDTO, WorkspaceDTO, WorkspaceSnapshotDTO } from "@xiranite/shared"
import type { WorkspaceRepository } from "./index.js"

const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  icon: text("icon"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

const lanes = sqliteTable("lanes", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  workspaceId: text("workspace_id").notNull(),
  widthRatio: real("width_ratio").notNull(),
  collapsed: integer("collapsed", { mode: "boolean" }).notNull(),
  hidden: integer("hidden", { mode: "boolean" }),
  cardOrder: text("card_order"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

const components = sqliteTable("components", {
  id: text("id").primaryKey(),
  moduleId: text("module_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  data: text("data"),
  flowPosition: text("flow_position"),
  flowSize: text("flow_size"),
  dockPanel: text("dock_panel"),
  laneId: text("lane_id"),
  hiddenIn: text("hidden_in"),
  tags: text("tags"),
  z: real("z"),
  collapsed: integer("collapsed", { mode: "boolean" }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export interface LibsqlWorkspaceRepositoryOptions {
  url: string
  authToken?: string
}

export interface LibsqlWorkspaceRepository extends WorkspaceRepository {
  client: Client
}

type WorkspaceDb = Pick<LibSQLDatabase, "delete" | "insert">

export async function createLibsqlWorkspaceRepository(options: LibsqlWorkspaceRepositoryOptions): Promise<LibsqlWorkspaceRepository> {
  const client = createClient({
    url: options.url,
    authToken: options.authToken,
  })
  const db = drizzle(client)
  await ensureSchema(client)

  return {
    client,
    async listWorkspaces() {
      const rows = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt), asc(workspaces.id))
      return rows.map(toWorkspaceDTO)
    },
    async createWorkspace(workspace) {
      await db.insert(workspaces).values(fromWorkspaceDTO(workspace)).onConflictDoUpdate({
        target: workspaces.id,
        set: {
          label: workspace.label,
          icon: workspace.icon ?? null,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        },
      })
      return workspace
    },
    async renameWorkspace(id, label, updatedAt) {
      const result = await db.update(workspaces)
        .set({ label, updatedAt })
        .where(eq(workspaces.id, id))
        .returning()

      const workspace = result[0]
      if (!workspace) throw new Error(`Workspace not found: ${id}`)
      return toWorkspaceDTO(workspace)
    },
    async deleteWorkspace(id) {
      await db.transaction(async (tx) => {
        await tx.delete(components).where(eq(components.workspaceId, id))
        await tx.delete(lanes).where(eq(lanes.workspaceId, id))
        await tx.delete(workspaces).where(eq(workspaces.id, id))
      })
    },
    async listLanes() {
      const rows = await db.select().from(lanes).orderBy(asc(lanes.createdAt), asc(lanes.id))
      return rows.map(toLaneDTO)
    },
    async listComponents() {
      const rows = await db.select().from(components).orderBy(asc(components.createdAt), asc(components.id))
      return rows.map(toComponentDTO)
    },
    async saveSnapshot(snapshot) {
      await db.transaction(async (tx) => {
        await replaceRows(tx, snapshot)
      })
      return snapshot
    },
  }
}

async function ensureSchema(client: Client): Promise<void> {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      icon TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS lanes (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      width_ratio REAL NOT NULL,
      collapsed INTEGER NOT NULL,
      hidden INTEGER,
      card_order TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS lanes_workspace_id_idx ON lanes (workspace_id)`,
    `CREATE TABLE IF NOT EXISTS components (
      id TEXT PRIMARY KEY NOT NULL,
      module_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      data TEXT,
      flow_position TEXT,
      flow_size TEXT,
      dock_panel TEXT,
      lane_id TEXT,
      hidden_in TEXT,
      tags TEXT,
      z REAL,
      collapsed INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS components_workspace_id_idx ON components (workspace_id)`,
    `CREATE INDEX IF NOT EXISTS components_lane_id_idx ON components (lane_id)`,
  ], "write")
}

async function replaceRows(db: WorkspaceDb, snapshot: WorkspaceSnapshotDTO): Promise<void> {
  const workspaceIds = snapshot.workspaces.map((workspace) => workspace.id)
  if (workspaceIds.length === 0) {
    await db.delete(components)
    await db.delete(lanes)
    await db.delete(workspaces)
    return
  }

  await db.delete(components).where(notInWorkspaceIds(components.workspaceId, workspaceIds))
  await db.delete(lanes).where(notInWorkspaceIds(lanes.workspaceId, workspaceIds))
  await db.delete(workspaces).where(notInWorkspaceIds(workspaces.id, workspaceIds))

  for (const workspace of snapshot.workspaces) {
    await db.insert(workspaces).values(fromWorkspaceDTO(workspace)).onConflictDoUpdate({
      target: workspaces.id,
      set: {
        label: workspace.label,
        icon: workspace.icon ?? null,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    })
  }

  await db.delete(lanes).where(inArray(lanes.workspaceId, workspaceIds))
  if (snapshot.lanes.length) {
    await db.insert(lanes).values(snapshot.lanes.map(fromLaneDTO))
  }

  await db.delete(components).where(inArray(components.workspaceId, workspaceIds))
  if (snapshot.components.length) {
    await db.insert(components).values(snapshot.components.map(fromComponentDTO))
  }
}

function notInWorkspaceIds(column: typeof workspaces.id | typeof lanes.workspaceId | typeof components.workspaceId, workspaceIds: string[]) {
  return not(inArray(column, workspaceIds))
}

function fromWorkspaceDTO(workspace: WorkspaceDTO): typeof workspaces.$inferInsert {
  return {
    id: workspace.id,
    label: workspace.label,
    icon: workspace.icon ?? null,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

function toWorkspaceDTO(row: typeof workspaces.$inferSelect): WorkspaceDTO {
  return {
    id: row.id,
    label: row.label,
    icon: row.icon ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function fromLaneDTO(lane: LaneDTO): typeof lanes.$inferInsert {
  return {
    id: lane.id,
    label: lane.label,
    workspaceId: lane.workspaceId,
    widthRatio: lane.widthRatio,
    collapsed: lane.collapsed,
    hidden: lane.hidden ?? null,
    cardOrder: serialize(lane.cardOrder),
    createdAt: lane.createdAt,
    updatedAt: lane.updatedAt,
  }
}

function toLaneDTO(row: typeof lanes.$inferSelect): LaneDTO {
  return {
    id: row.id,
    label: row.label,
    workspaceId: row.workspaceId,
    widthRatio: row.widthRatio,
    collapsed: row.collapsed,
    hidden: row.hidden ?? undefined,
    cardOrder: deserialize<string[]>(row.cardOrder),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function fromComponentDTO(component: ComponentDTO): typeof components.$inferInsert {
  return {
    id: component.id,
    moduleId: component.moduleId,
    workspaceId: component.workspaceId,
    data: serialize(component.data),
    flowPosition: serialize(component.flowPosition),
    flowSize: serialize(component.flowSize),
    dockPanel: component.dockPanel ?? null,
    laneId: component.laneId ?? null,
    hiddenIn: serialize(component.hiddenIn),
    tags: serialize(component.tags),
    z: component.z ?? null,
    collapsed: component.collapsed ?? null,
    createdAt: component.createdAt,
    updatedAt: component.updatedAt,
  }
}

function toComponentDTO(row: typeof components.$inferSelect): ComponentDTO {
  return {
    id: row.id,
    moduleId: row.moduleId,
    workspaceId: row.workspaceId,
    data: deserialize<Record<string, unknown>>(row.data),
    flowPosition: deserialize<{ x: number; y: number }>(row.flowPosition),
    flowSize: deserialize<{ width: number; height: number }>(row.flowSize),
    dockPanel: row.dockPanel ?? undefined,
    laneId: row.laneId ?? undefined,
    hiddenIn: deserialize<ComponentDTO["hiddenIn"]>(row.hiddenIn),
    tags: deserialize<string[]>(row.tags),
    z: row.z ?? undefined,
    collapsed: row.collapsed ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serialize(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function deserialize<T>(value: string | null): T | undefined {
  return value === null ? undefined : JSON.parse(value) as T
}
