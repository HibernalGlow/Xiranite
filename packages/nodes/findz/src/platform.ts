export interface FindzRuntime {
  readonly runtime: "bun-worker"
}

export function createNodeFindzRuntime(): FindzRuntime {
  return { runtime: "bun-worker" }
}
