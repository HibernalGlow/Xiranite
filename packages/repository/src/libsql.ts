import { createClient, type Client } from "@libsql/client"
import { asc, desc, eq, inArray, not, and, lt, type SQL } from "drizzle-orm"
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql"
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type {
  ComponentDTO,
  LaneDTO,
  NodeRunHistoryClearQueryDTO,
  NodeRunHistoryClearResultDTO,
  NodeRunHistoryItemDTO,
  NodeRunHistoryListDTO,
  NodeRunHistoryQueryDTO,
  RuntimeHistoryClearQueryDTO,
  RuntimeHistoryClearResultDTO,
  RuntimeHistoryItemDTO,
  RuntimeHistoryListDTO,
  RuntimeHistoryQueryDTO,
  WorkspaceDTO,
  WorkspaceSnapshotDTO,
} from "@xiranite/shared"
import type { NodeRunHistoryRepository, WorkspaceRepository } from "./index.js"

const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  icon: text("icon"),
  flowCanvas: text("flow_canvas"),
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
  laneSize: text("lane_size"),
  dockPanel: text("dock_panel"),
  laneId: text("lane_id"),
  hiddenIn: text("hidden_in"),
  tags: text("tags"),
  z: real("z"),
  collapsed: integer("collapsed", { mode: "boolean" }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

const nodeRunHistory = sqliteTable("node_run_history", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull(),
  componentId: text("component_id"),
  workspaceId: text("workspace_id"),
  input: text("input"),
  inputSummary: text("input_summary"),
  status: text("status").notNull(),
  message: text("message").notNull(),
  result: text("result"),
  eventCount: integer("event_count").notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at").notNull(),
  durationMs: integer("duration_ms").notNull(),
})

const runtimeHistory = sqliteTable("runtime_history", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  operation: text("operation").notNull(),
  status: text("status").notNull(),
  title: text("title"),
  message: text("message").notNull(),
  target: text("target"),
  nodeId: text("node_id"),
  componentId: text("component_id"),
  workspaceId: text("workspace_id"),
  input: text("input"),
  inputSummary: text("input_summary"),
  result: text("result"),
  resultSummary: text("result_summary"),
  metadata: text("metadata"),
  eventCount: integer("event_count"),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at").notNull(),
  durationMs: integer("duration_ms").notNull(),
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
          flowCanvas: serialize(workspace.flowCanvas),
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
      flow_canvas TEXT,
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
      lane_size TEXT,
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
    `CREATE TABLE IF NOT EXISTS node_run_history (
      id TEXT PRIMARY KEY NOT NULL,
      node_id TEXT NOT NULL,
      component_id TEXT,
      workspace_id TEXT,
      input TEXT,
      input_summary TEXT,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      result TEXT,
      event_count INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS node_run_history_node_id_idx ON node_run_history (node_id, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS node_run_history_component_id_idx ON node_run_history (component_id, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS node_run_history_workspace_id_idx ON node_run_history (workspace_id, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS node_run_history_finished_at_idx ON node_run_history (finished_at DESC)`,
    ...runtimeHistorySchemaSql(),
  ], "write")
  await addColumnIfMissing(client, "workspaces", "flow_canvas", "TEXT")
  await addColumnIfMissing(client, "components", "lane_size", "TEXT")
}

async function addColumnIfMissing(client: Client, table: string, column: string, type: string): Promise<void> {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch (error) {
    if (error instanceof Error && /duplicate column/i.test(error.message)) return
    throw error
  }
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
        flowCanvas: serialize(workspace.flowCanvas),
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
    flowCanvas: serialize(workspace.flowCanvas),
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

function toWorkspaceDTO(row: typeof workspaces.$inferSelect): WorkspaceDTO {
  const flowCanvas = deserialize<Record<string, unknown>>(row.flowCanvas)
  return {
    id: row.id,
    label: row.label,
    icon: row.icon ?? undefined,
    ...(flowCanvas === undefined ? {} : { flowCanvas }),
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
    laneSize: serialize(component.laneSize),
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
    laneSize: deserialize<{ height: number }>(row.laneSize),
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

// ── Libsql NodeRunHistoryRepository ────────────────────────────────

export interface LibsqlNodeRunHistoryRepositoryOptions {
  url: string
  authToken?: string
}

export interface LibsqlNodeRunHistoryRepository extends NodeRunHistoryRepository {
  client: Client
}

export async function createLibsqlNodeRunHistoryRepository(
  options: LibsqlNodeRunHistoryRepositoryOptions,
): Promise<LibsqlNodeRunHistoryRepository> {
  const client = createClient({
    url: options.url,
    authToken: options.authToken,
  })
  const db = drizzle(client)
  await ensureHistorySchema(client)

  const repository: LibsqlNodeRunHistoryRepository = {
    client,
    async createRuntimeHistory(item) {
      await db.insert(runtimeHistory).values(fromRuntimeHistoryItemDTO(item)).onConflictDoUpdate({
        target: runtimeHistory.id,
        set: {
          kind: item.kind,
          operation: item.operation,
          status: item.status,
          title: item.title ?? null,
          message: item.message,
          target: serialize(item.target),
          nodeId: item.nodeId ?? null,
          componentId: item.componentId ?? null,
          workspaceId: item.workspaceId ?? null,
          input: serialize(item.input),
          inputSummary: item.inputSummary ?? null,
          result: serialize(item.result),
          resultSummary: item.resultSummary ?? null,
          metadata: serialize(item.metadata),
          eventCount: item.eventCount ?? null,
          finishedAt: item.finishedAt,
          durationMs: item.durationMs,
        },
      })
      return item
    },
    async listRuntimeHistory(query) {
      const conditions = runtimeHistoryConditions(query)

      let rows = await db.select().from(runtimeHistory)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(runtimeHistory.finishedAt), desc(runtimeHistory.id))
        .limit((query.limit ?? 50) + 1)

      let nextCursor: string | null = null
      if (rows.length > (query.limit ?? 50)) {
        const limit = query.limit ?? 50
        const last = rows[limit - 1]
        nextCursor = last?.id ?? null
        rows = rows.slice(0, limit)
      }

      return {
        items: rows.map(toRuntimeHistoryItemDTO),
        nextCursor,
      }
    },
    async getRuntimeHistory(id) {
      const rows = await db.select().from(runtimeHistory).where(eq(runtimeHistory.id, id)).limit(1)
      const row = rows[0]
      return row ? toRuntimeHistoryItemDTO(row) : undefined
    },
    async deleteRuntimeHistory(id) {
      await db.delete(runtimeHistory).where(eq(runtimeHistory.id, id))
    },
    async clearRuntimeHistory(query) {
      const conditions = runtimeHistoryConditions(query)
      if (query.before !== undefined) conditions.push(lt(runtimeHistory.finishedAt, query.before))

      const before = await db.select({ id: runtimeHistory.id }).from(runtimeHistory)
        .where(conditions.length ? and(...conditions) : undefined)
      const deletedCount = before.length
      if (deletedCount > 0) {
        await db.delete(runtimeHistory).where(
          inArray(runtimeHistory.id, before.map((row) => row.id)),
        )
      }
      return { deletedCount }
    },
    async createNodeRunHistory(item) {
      await repository.createRuntimeHistory(nodeHistoryToRuntimeHistory(item))
      return item
    },
    async listNodeRunHistory(query) {
      const result = await repository.listRuntimeHistory({ ...query, kind: "node" })
      return {
        items: result.items.map(runtimeHistoryToNodeHistory).filter((item): item is NodeRunHistoryItemDTO => item !== undefined),
        nextCursor: result.nextCursor,
      }
    },
    async getNodeRunHistory(id) {
      const item = await repository.getRuntimeHistory(id)
      return item ? runtimeHistoryToNodeHistory(item) : undefined
    },
    async deleteNodeRunHistory(id) {
      await repository.deleteRuntimeHistory(id)
    },
    async clearNodeRunHistory(query) {
      return await repository.clearRuntimeHistory({ ...query, kind: "node" })
    },
  }
  return repository
}

async function ensureHistorySchema(client: Client): Promise<void> {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS node_run_history (
      id TEXT PRIMARY KEY NOT NULL,
      node_id TEXT NOT NULL,
      component_id TEXT,
      workspace_id TEXT,
      input TEXT,
      input_summary TEXT,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      result TEXT,
      event_count INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS node_run_history_node_id_idx ON node_run_history (node_id, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS node_run_history_component_id_idx ON node_run_history (component_id, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS node_run_history_workspace_id_idx ON node_run_history (workspace_id, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS node_run_history_finished_at_idx ON node_run_history (finished_at DESC)`,
    ...runtimeHistorySchemaSql(),
  ], "write")
}

function runtimeHistorySchemaSql(): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS runtime_history (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT,
      message TEXT NOT NULL,
      target TEXT,
      node_id TEXT,
      component_id TEXT,
      workspace_id TEXT,
      input TEXT,
      input_summary TEXT,
      result TEXT,
      result_summary TEXT,
      metadata TEXT,
      event_count INTEGER,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS runtime_history_kind_idx ON runtime_history (kind, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS runtime_history_operation_idx ON runtime_history (operation, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS runtime_history_node_id_idx ON runtime_history (node_id, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS runtime_history_component_id_idx ON runtime_history (component_id, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS runtime_history_workspace_id_idx ON runtime_history (workspace_id, finished_at DESC)`,
    `CREATE INDEX IF NOT EXISTS runtime_history_finished_at_idx ON runtime_history (finished_at DESC)`,
  ]
}

function toNodeRunHistoryItemDTO(row: typeof nodeRunHistory.$inferSelect): NodeRunHistoryItemDTO {
  return {
    id: row.id,
    nodeId: row.nodeId,
    componentId: row.componentId ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    input: deserialize<unknown>(row.input),
    inputSummary: row.inputSummary ?? undefined,
    status: row.status as NodeRunHistoryItemDTO["status"],
    message: row.message,
    result: deserialize<NodeRunHistoryItemDTO["result"]>(row.result),
    eventCount: row.eventCount,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
  }
}

function fromRuntimeHistoryItemDTO(item: RuntimeHistoryItemDTO): typeof runtimeHistory.$inferInsert {
  return {
    id: item.id,
    kind: item.kind,
    operation: item.operation,
    status: item.status,
    title: item.title ?? null,
    message: item.message,
    target: serialize(item.target),
    nodeId: item.nodeId ?? null,
    componentId: item.componentId ?? null,
    workspaceId: item.workspaceId ?? null,
    input: serialize(item.input),
    inputSummary: item.inputSummary ?? null,
    result: serialize(item.result),
    resultSummary: item.resultSummary ?? null,
    metadata: serialize(item.metadata),
    eventCount: item.eventCount ?? null,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    durationMs: item.durationMs,
  }
}

function toRuntimeHistoryItemDTO(row: typeof runtimeHistory.$inferSelect): RuntimeHistoryItemDTO {
  return {
    id: row.id,
    kind: row.kind as RuntimeHistoryItemDTO["kind"],
    operation: row.operation,
    status: row.status as RuntimeHistoryItemDTO["status"],
    title: row.title ?? undefined,
    message: row.message,
    target: deserialize<RuntimeHistoryItemDTO["target"]>(row.target),
    nodeId: row.nodeId ?? undefined,
    componentId: row.componentId ?? undefined,
    workspaceId: row.workspaceId ?? undefined,
    input: deserialize<unknown>(row.input),
    inputSummary: row.inputSummary ?? undefined,
    result: deserialize<unknown>(row.result),
    resultSummary: row.resultSummary ?? undefined,
    metadata: deserialize<Record<string, unknown>>(row.metadata),
    eventCount: row.eventCount ?? undefined,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
  }
}

function runtimeHistoryConditions(query: RuntimeHistoryQueryDTO | RuntimeHistoryClearQueryDTO): SQL[] {
  const conditions: SQL[] = []
  if (query.kind) conditions.push(eq(runtimeHistory.kind, query.kind))
  if (query.operation) conditions.push(eq(runtimeHistory.operation, query.operation))
  if (query.nodeId) conditions.push(eq(runtimeHistory.nodeId, query.nodeId))
  if (query.componentId) conditions.push(eq(runtimeHistory.componentId, query.componentId))
  if (query.workspaceId) conditions.push(eq(runtimeHistory.workspaceId, query.workspaceId))
  if ("status" in query && query.status) conditions.push(eq(runtimeHistory.status, query.status))
  return conditions
}

function nodeHistoryToRuntimeHistory(item: NodeRunHistoryItemDTO): RuntimeHistoryItemDTO {
  return {
    id: item.id,
    kind: "node",
    operation: "node.run",
    status: item.status,
    title: item.nodeId,
    message: item.message,
    target: { type: "node", id: item.nodeId, label: item.nodeId },
    nodeId: item.nodeId,
    componentId: item.componentId,
    workspaceId: item.workspaceId,
    input: item.input,
    inputSummary: item.inputSummary,
    result: item.result,
    resultSummary: item.result?.message,
    eventCount: item.eventCount,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    durationMs: item.durationMs,
  }
}

function runtimeHistoryToNodeHistory(item: RuntimeHistoryItemDTO): NodeRunHistoryItemDTO | undefined {
  if (item.kind !== "node" || !item.nodeId) return undefined
  if (item.status !== "success" && item.status !== "error" && item.status !== "cancelled") return undefined
  return {
    id: item.id,
    nodeId: item.nodeId,
    componentId: item.componentId,
    workspaceId: item.workspaceId,
    input: item.input,
    inputSummary: item.inputSummary,
    status: item.status,
    message: item.message,
    result: item.result as NodeRunHistoryItemDTO["result"],
    eventCount: item.eventCount ?? 0,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    durationMs: item.durationMs,
  }
}
