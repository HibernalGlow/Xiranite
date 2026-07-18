import type { AppNodeEntry } from "@xiranite/contract"
import { core, def } from "@xiranite/node-czkawka"
import { Component } from "./Component"

export default {
  def,
  core,
  Component,
  host: { contractVersion: "^1.0.0", capabilities: ["state", "runner", "localFiles", "clipboard", "config", "env"] },
} satisfies AppNodeEntry<typeof core>
