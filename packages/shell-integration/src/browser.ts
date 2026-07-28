import type { WindowsRegistryAdapter } from "./core.js"

export * from "./core.js"

/** Browser clients can render plans but must delegate registry writes to a host. */
export function createNodeWindowsRegistryAdapter(): WindowsRegistryAdapter {
  throw new Error("Windows registry registration is only available through a Node host adapter.")
}
