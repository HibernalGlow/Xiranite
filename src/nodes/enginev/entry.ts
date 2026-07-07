import type { AppNodeEntry } from "@xiranite/contract"
import { core, def } from "@xiranite/node-enginev"
import { Component } from "./Component"

export default {
  def,
  core,
  Component,
} satisfies AppNodeEntry<typeof core>
