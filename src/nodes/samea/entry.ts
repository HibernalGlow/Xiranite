import type { AppNodeEntry } from "@xiranite/contract"
import type { SameaCardState } from "./types"
import { core, def } from "@xiranite/node-samea"
import { Component } from "./Component"

export default { def, core, Component } satisfies AppNodeEntry<typeof core, SameaCardState, Partial<SameaCardState>>
