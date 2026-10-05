import type { AppNodeEntry } from "@xiranite/contract"
import type { TimeuCardState } from "./types"
import { core, def } from "@xiranite/node-timeu"
import { Component } from "./Component"

export default { def, core, Component } satisfies AppNodeEntry<typeof core, TimeuCardState, Partial<TimeuCardState>>
