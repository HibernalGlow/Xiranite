// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test } from "vitest"
import { useState } from "react"
import type { NodeLocalFilesCapability } from "@xiranite/contract"
import { useLocalFileDrop } from "./useLocalFileDrop"

afterEach(cleanup)

describe("useLocalFileDrop", () => {
  test("routes native paths only to the matching target", async () => {
    const handlers = new Map<string, (paths: string[]) => void>()
    const subscribeDrops: NonNullable<NodeLocalFilesCapability["subscribeDrops"]> = async (targetId, handler) => {
      handlers.set(targetId, handler)
      return () => handlers.delete(targetId)
    }
    render(<><Probe name="first" subscribeDrops={subscribeDrops} /><Probe name="second" subscribeDrops={subscribeDrops} /></>)
    await waitFor(() => expect(handlers.size).toBe(2))

    const second = screen.getByTestId("second")
    handlers.get(second.id)?.(["D:/images/second.png"])

    expect(screen.getByTestId("first-value").textContent).toBe("")
    await waitFor(() => expect(screen.getByTestId("second-value").textContent).toBe("D:/images/second.png"))
  })

  test("uses host-provided File.path without a native subscription", () => {
    render(<Probe name="direct" />)
    const file = new File(["image"], "direct.png")
    Object.defineProperty(file, "path", { value: "D:/images/direct.png" })
    fireEvent.drop(screen.getByTestId("direct"), { dataTransfer: { files: [file] } })
    expect(screen.getByTestId("direct-value").textContent).toBe("D:/images/direct.png")
  })
})

function Probe(props: { name: string; subscribeDrops?: NodeLocalFilesCapability["subscribeDrops"] }) {
  const [value, setValue] = useState("")
  const drop = useLocalFileDrop({ subscribeDrops: props.subscribeDrops, onDropPaths: (paths) => setValue(paths.join("\n")) })
  return <div><div {...drop.targetProps} data-testid={props.name} /><output data-testid={`${props.name}-value`}>{value}</output></div>
}
