import type { AppNodeEntry } from "@xiranite/contract"
import { core, def } from "@xiranite/node-nameu"
import { Component } from "./Component"

export default { def, core, Component } satisfies AppNodeEntry<typeof core>
