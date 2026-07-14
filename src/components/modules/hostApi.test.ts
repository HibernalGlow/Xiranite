import { describe, expect, test } from "vitest"
import { localPathToFileUrl, parentLocalPath } from "./hostApi"

describe("node host local path helpers", () => {
  test("creates system-compatible file URLs for Windows, UNC, and POSIX paths", () => {
    expect(localPathToFileUrl("D:\\Media Files\\image #1.avif")).toBe("file:///D:/Media%20Files/image%20%231.avif")
    expect(localPathToFileUrl("\\\\server\\share\\image 1.jpg")).toBe("file://server/share/image%201.jpg")
    expect(localPathToFileUrl("/home/user/image 1.jpg")).toBe("file:///home/user/image%201.jpg")
  })

  test("finds the parent for slash variants", () => {
    expect(parentLocalPath("D:\\Media\\image.jpg")).toBe("D:/Media")
    expect(parentLocalPath("/home/user/image.jpg")).toBe("/home/user")
  })
})
