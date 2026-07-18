/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils";
import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createTrenameInteractionSchema } from "./interaction.js";
import { flattenJsonTree, TrenameTui } from "./Tui.js";

describe("Trename direct OpenTUI", () => {
  test("flattens rename JSON into a review tree", () => {
    expect(flattenJsonTree(JSON.stringify({ root: [{ src_dir: "Album", tgt_dir: "画集", children: [{ src: "old.jpg", tgt: "new.jpg" }] }] }))).toEqual([
      { key: "/Album", depth: 0, name: "Album", target: "画集", directory: true, ready: true },
      { key: "/Album/old.jpg", depth: 1, name: "old.jpg", target: "new.jpg", directory: false, ready: true },
    ]);
  });

  test("renders tree, rename diff, conflict review and safety controls", async () => {
    const jsonContent = JSON.stringify({ root: [{ src: "old.jpg", tgt: "new.jpg" }] });
    const setup = await testRender(<TrenameTui definition={{
      schema: createTrenameInteractionSchema({ action: "validate", jsonContent, basePath: "D:/gallery" }, "zh"),
      run: async () => ({ success: true, message: "校验完成", data: {
        jsonContent, segments: [jsonContent], totalItems: 1, pendingCount: 0, readyCount: 1,
        successCount: 0, failedCount: 0, skippedCount: 0, operationId: "", conflicts: [],
        operations: [{ originalPath: "D:/gallery/old.jpg", newPath: "D:/gallery/new.jpg" }], history: [], basePath: "D:/gallery", errors: [],
      } }),
    }} language="zh" onExit={() => undefined} />, { width: 150, height: 38, useMouse: true });
    try {
      await act(async () => setup.renderOnce());
      const frame = setup.captureCharFrame();
      expect(frame).toContain("TRENAME // 重命名审阅台");
      expect(frame).toContain("目录结构");
      expect(frame).toContain("路径差异");
      expect(frame).toContain("冲突与状态");
      expect(frame).toContain("校验差异");
    } finally { await act(async () => setup.renderer.destroy()); }
  });
});
