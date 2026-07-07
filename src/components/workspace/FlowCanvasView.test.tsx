// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { FlowCanvasView } from "./FlowCanvasView"

const setComponentVisibilityMock = vi.hoisted(() => vi.fn())
const visibleComponentsMock = vi.hoisted(() => vi.fn(() => []))
const editorMock = vi.hoisted(() => ({
  getCurrentPageShapes: vi.fn(() => []),
  deleteShapes: vi.fn(),
  createShapes: vi.fn(),
  updateShapes: vi.fn(),
  sideEffects: {
    registerAfterChangeHandler: vi.fn(() => vi.fn()),
    registerAfterDeleteHandler: vi.fn(() => vi.fn()),
  },
}))

vi.mock("@/store/workspaceContext", () => ({
  useWorkspaceActions: () => ({
    setComponentFlowPos: vi.fn(),
    setComponentFlowSize: vi.fn(),
    setComponentVisibility: setComponentVisibilityMock,
  }),
  useWorkspaceVisibleComponents: visibleComponentsMock,
}))

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "light" }),
}))

vi.mock("tldraw", () => ({
  HTMLContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Rectangle2d: class Rectangle2d {},
  ShapeUtil: class ShapeUtil {},
  Tldraw: ({ children }: { children: ReactNode }) => <div data-testid="mock-tldraw">{children}</div>,
  createShapeId: (id: string) => `shape:${id}`,
  defaultShapeUtils: [],
  useEditor: () => editorMock,
}))

vi.mock("tldraw/tldraw.css", () => ({}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  visibleComponentsMock.mockReturnValue([])
  editorMock.getCurrentPageShapes.mockReturnValue([])
})

describe("FlowCanvasView", () => {
  test("hides a component from flow when its tldraw module shape is deleted", () => {
    render(<FlowCanvasView />)

    const deleteHandler = editorMock.sideEffects.registerAfterDeleteHandler.mock.calls.find(
      ([typeName]) => typeName === "shape",
    )?.[1]

    expect(deleteHandler).toBeTypeOf("function")

    act(() => {
      deleteHandler?.(
        {
          type: "module",
          props: { compId: "comp-flow-ghost" },
        },
        "user",
      )
    })

    expect(setComponentVisibilityMock).toHaveBeenCalledWith("comp-flow-ghost", "flow", false)
  })

  test("does not recreate a previously synced shape that is missing from the canvas", () => {
    const oldComponent = createFlowComponent("comp-old", "bandia")
    const newComponent = createFlowComponent("comp-new", "cleanf")

    visibleComponentsMock.mockReturnValue([oldComponent])
    const { rerender } = render(<FlowCanvasView />)

    expect(editorMock.createShapes).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "shape:comp-old",
        props: expect.objectContaining({ compId: "comp-old" }),
      }),
    ])

    editorMock.createShapes.mockClear()
    setComponentVisibilityMock.mockClear()
    visibleComponentsMock.mockReturnValue([oldComponent, newComponent])

    rerender(<FlowCanvasView />)

    expect(setComponentVisibilityMock).toHaveBeenCalledWith("comp-old", "flow", false)
    expect(editorMock.createShapes).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "shape:comp-new",
        props: expect.objectContaining({ compId: "comp-new" }),
      }),
    ])
  })
})

function createFlowComponent(id: string, moduleId: string) {
  return {
    id,
    moduleId,
    workspaceId: "ws-test",
    data: {},
    state: "docked",
    hiddenIn: { flow: false },
    createdAt: 1,
    updatedAt: 1,
  }
}
