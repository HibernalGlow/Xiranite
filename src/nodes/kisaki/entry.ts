import type { AppNodeEntry } from "@xiranite/contract"
import type { KisakiCardState } from "./types"
import type { KisakiNodeConfig } from "./node-config"
import { core, def } from "@xiranite/node-kisaki"
import { Component } from "./Component"

export default {
  def,
  core,
  Component,
  nodeApp: {
    nativeProbe: { module: "@xiranite/czkawka-native", exportName: "getCzkawkaInfo" },
    releaseGate: { script: "scripts/smoke-node-app-kisaki.ts" },
  },
  host: { contractVersion: "^1.0.0", capabilities: ["state", "runner", "localFiles", "clipboard", "config", "env"] },
} satisfies AppNodeEntry<typeof core, KisakiCardState, Partial<KisakiNodeConfig>>
