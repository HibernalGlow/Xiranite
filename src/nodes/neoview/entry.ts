import type { AppNodeEntry } from "@xiranite/contract"
import { def } from "@xiranite/node-neoview/ui-core"
import * as core from "@xiranite/node-neoview/ui-core"

import { Component, type NeoViewCardState } from "./Component"
import { neoviewDebug } from "./neoviewDebug"

// Marks when the NeoView entry chunk finishes evaluating (after code-split load).
neoviewDebug("entry:evaluated", { t: Math.round(performance.now() * 10) / 10 })

export default {
  def,
  core,
  Component,
  host: { contractVersion: "^1.0.0", capabilities: ["state", "localFiles"] },
  window: { maximizeBehavior: "fullscreen" },
} satisfies AppNodeEntry<typeof core, NeoViewCardState>
