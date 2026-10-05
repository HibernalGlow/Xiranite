import type { AppNodeEntry } from "@xiranite/contract"
import type { SmartZipCardState } from "./types"
import { core, def } from "@xiranite/node-smartzip"
import { Component } from "./Component"

export default { def, core, Component } satisfies AppNodeEntry<typeof core, SmartZipCardState, Partial<SmartZipCardState>>
