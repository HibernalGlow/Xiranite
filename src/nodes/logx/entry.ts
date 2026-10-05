import type { AppNodeEntry } from "@xiranite/contract"
import type { LogxCardState } from "./types"
import { core, def } from "@xiranite/node-logx"
import { Component } from "./Component"

export default { def, core, Component } satisfies AppNodeEntry<typeof core, LogxCardState, Partial<LogxCardState>>
