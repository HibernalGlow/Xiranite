import type { AppNodeEntry } from "@xiranite/contract"
import type { NameuCardState } from "./types"
import { core, def } from "@xiranite/node-nameu"
import { Component } from "./Component"

export default { def, core, Component } satisfies AppNodeEntry<typeof core, NameuCardState, Partial<NameuCardState>>
