// @vitest-environment happy-dom
import { NODE_SURFACE_TEST_MODES } from "@/nodes/shared/nodeSurfaceTestUtils"
import { describePackuMigratedToolComponent } from "@/nodes/shared/packuToolTestUtils"
import { Component } from "./Component"

describePackuMigratedToolComponent({
  Component,
  nodeId: "classf",
  title: "ClassF",
  surfaceModes: NODE_SURFACE_TEST_MODES,
})
