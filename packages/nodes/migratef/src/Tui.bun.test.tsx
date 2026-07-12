/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils";
import { expect, test } from "bun:test";
import { act } from "react";
import { createMigratefInteractionSchema } from "./interaction.js";
import { MigratefTui } from "./Tui.js";
test("MigrateF renders transfer diff", async () => {
  let runs = 0;
  const schema = createMigratefInteractionSchema(
      { sourcePaths: "D:/src", targetPath: "D:/dst" },
      "zh",
    ),
    x = await testRender(
      <MigratefTui
        definition={{
          schema,
          run: async () => {
            runs += 1;
            return ({
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
            });
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
    expect(f).toContain("MIGRATEF // TRANSFER DIFF");
    expect(f).toContain("来源队列");
    expect(f).toContain("目标映射 / DIFF");
    expect(f).toContain("撤销与遥测");
    const plan = x.renderer.root.findDescendantById("action-plan");
    expect(plan).toBeDefined();
    await act(async () => x.mockMouse.click(plan!.x + 2, plan!.y + 1));
    await x.waitFor(() => runs === 1);
    expect(runs).toBe(1);
  } finally {
    await act(async () => x.renderer.destroy());
  }
});

test("MigrateF opens confirmation directly from a dangerous action", async () => {
  let runs = 0;
  const setup = await testRender(
    <MigratefTui
      definition={{
        schema: createMigratefInteractionSchema({ sourcePaths: "D:/src", targetPath: "D:/dst", dryRun: false }, "zh"),
        run: async () => { runs += 1; return { success: true, message: "moved", data: { plan: [], history: [], migratedCount: 0, skippedCount: 0, errorCount: 0, totalCount: 0, operationId: "", successCount: 0, failedCount: 0, errors: [] } } },
      }}
      language="zh"
      onExit={() => undefined}
    />,
    { width: 142, height: 38, useMouse: true },
  );
  try {
    await act(async () => setup.renderOnce());
    const move = setup.renderer.root.findDescendantById("action-move");
    expect(move).toBeDefined();
    await act(async () => setup.mockMouse.click(move!.x + 2, move!.y + 1));
    await act(async () => setup.flush());
    expect(runs).toBe(0);
    expect(setup.captureCharFrame()).toContain("↯ 确认迁移");
  } finally {
    await act(async () => setup.renderer.destroy());
  }
});
