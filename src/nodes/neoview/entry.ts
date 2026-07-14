import type { AppNodeEntry } from "@xiranite/contract"
import { core, def } from "@xiranite/node-neoview"

import { Component, type NeoViewCardState } from "./Component"

export default {
  def,
  core,
  Component,
  host: { contractVersion: "^1.0.0", capabilities: ["state", "localFiles"] },
} satisfies AppNodeEntry<typeof core, NeoViewCardState>
