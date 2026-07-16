import type { AppNodeEntry } from "@xiranite/contract"
import { def } from "@xiranite/node-neoview/definition"
import * as core from "@xiranite/node-neoview/ui-core"

import { Component, type NeoViewCardState } from "./Component"

export default {
  def,
  core,
  Component,
  host: { contractVersion: "^1.0.0", capabilities: ["state", "localFiles"] },
} satisfies AppNodeEntry<typeof core, NeoViewCardState>
