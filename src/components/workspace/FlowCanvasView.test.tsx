// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react"
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
  HTMLContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Rectangle2d: class Rectangle2d {},
  ShapeUtil: class ShapeUtil {},
  Tldraw: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-tldraw">{children}</div>,
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
})
