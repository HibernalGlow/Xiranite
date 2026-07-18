/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils";
import { expect, test } from "bun:test";
import { act } from "react";
import { createFindzInteractionSchema } from "./interaction.js";
import { FindzTui } from "./Tui.js";
test("FindZ renders query radar and launches help once", async () => {
  let runs = 0;
  const schema = createFindzInteractionSchema({ paths: "D:/library" }, "zh"),
    x = await testRender(
      <FindzTui
        definition={{
          schema,
          run: async (input) => {
            runs++;
            return {
              success: true,
              message: "ok",
              data: {
                action: input.action ?? "search",
                totalCount: 0,
                fileCount: 0,
                dirCount: 0,
                archiveCount: 0,
                nestedCount: 0,
                files: [],
                groups: [],
                byExtension: {},
                byArchive: {},
                errors: [],
                paths: [],
                where: "1",
                scannedFiles: 0,
                elapsedMs: 0,
                truncated: false,
                returnedCount: 0,
              },
            };
          },
        }}
        language="zh"
        onExit={() => undefined}
      />,
      { width: 142, height: 38, useMouse: true },
    );
  try {
    await act(async () => x.renderOnce());
    const f = x.captureCharFrame();
    expect(f).toContain("FINDZ // ARCHIVE QUERY RADAR");
    expect(f).toContain("结果表");
    expect(f).toContain("分组雷达");
    const h = x.renderer.root.findDescendantById("help-action-help");
    expect(h).toBeDefined();
    await act(async () => x.mockMouse.click(h!.x + 2, h!.y + 1));
    await x.waitFor(() => runs === 1);
    expect(runs).toBe(1);
  } finally {
    await act(async () => x.renderer.destroy());
  }
});
