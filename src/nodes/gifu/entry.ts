import type { AppNodeEntry } from "@xiranite/contract"
import type { GifuCardState } from "./types"
import { core, def } from "@xiranite/node-gifu"
import { Component } from "./Component"

export default { def, core, Component } satisfies AppNodeEntry<typeof core, GifuCardState, Partial<GifuCardState>>
