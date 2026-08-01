import type { AppNodeEntry } from "@xiranite/contract"
import * as core from "@xiranite/node-clipm/core"
import { def } from "@xiranite/node-clipm/definition"
import { Component } from "./Component"

export default { def, core, Component } satisfies AppNodeEntry<typeof core>
