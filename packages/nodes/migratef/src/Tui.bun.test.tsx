/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils";
import { expect, test } from "bun:test";
import { act } from "react";
import { createMigratefInteractionSchema } from "./interaction.js";
import { MigratefTui } from "./Tui.js";
test("MigrateF renders transfer diff", async () => {
  const schema = createMigratefInteractionSchema(
      { sourcePaths: "D:/src", targetPath: "D:/dst" },
      "zh",
    ),
    x = await testRender(
      <MigratefTui
        definition={{
          schema,
          run: async () => ({
            success: true,
            message: "plan",
            data: {
              plan: [],
              history: [],
              migratedCount: 0,
              skippedCount: 0,
              errorCount: 0,
              totalCount: 0,
              operationId: "",
              successCount: 0,
              failedCount: 0,
              errors: [],
            },
          }),
        }}
        language="zh"
        onExit={() => undefined}
      />,
      { width: 142, height: 38, useMouse: true },
    );
  try {
    await act(async () => x.renderOnce());
    const f = x.captureCharFrame();
    expect(f).toContain("MIGRATEF // TRANSFER DIFF");
    expect(f).toContain("来源队列");
    expect(f).toContain("目标映射 / DIFF");
    expect(f).toContain("撤销与遥测");
  } finally {
    await act(async () => x.renderer.destroy());
  }
});
