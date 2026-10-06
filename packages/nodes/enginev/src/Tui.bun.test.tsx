/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { expect, test } from "bun:test";
import { createEngineVInteractionSchema } from "./interaction.js";
import {
  EngineVTui,
  resolveGalleryColumns,
  resolveSixelImageSlots,
  shouldScheduleGalleryScroll,
} from "./Tui.js";

test("EngineV direct TUI renders image-capable workshop deck", async () => {
  const setup = await testRender(
    <EngineVTui
      definition={{
        schema: createEngineVInteractionSchema(
          { workshopPath: "C:/workshop", imageBackend: "half-block" },
          "zh",
        ),
        run: async () => ({
          success: true,
          message: "完成",
          data: {
            wallpapers: [],
            filteredWallpapers: [],
            totalCount: 0,
            filteredCount: 0,
            successCount: 0,
            failedCount: 0,
            typeStats: {},
            ratingStats: {},
            renameResults: [],
            deleteResults: [],
            exportPath: "",
            errors: [],
          },
        }),
      }}
      language="zh"
      onExit={() => undefined}
    />,
    { width: 128, height: 36, useMouse: true },
  );
  try {
    await act(async () => setup.renderOnce());
    const frame = setup.captureCharFrame();
    expect(frame).toContain("ENGINEV // WALLPAPER DECK");
    expect(frame).toContain("工坊图库 · 自动 3");
    expect(frame).toContain("并发");
    expect(frame).toContain("自动");
    expect(frame).toContain("扫描工坊");
  } finally {
    await act(async () => setup.renderer.destroy());
  }
});

test("EngineV gallery resolves responsive automatic columns", () => {
  expect([
    resolveGalleryColumns(70),
    resolveGalleryColumns(72),
    resolveGalleryColumns(105),
    resolveGalleryColumns(140),
    resolveGalleryColumns(170),
  ]).toEqual([1, 2, 3, 4, 5]);
});

test("EngineV gallery ignores wheel input beyond its scroll boundaries", () => {
  expect(shouldScheduleGalleryScroll("up", 0, 20)).toBeFalse();
  expect(shouldScheduleGalleryScroll("down", 20, 20)).toBeFalse();
  expect(shouldScheduleGalleryScroll("down", 19, 20)).toBeTrue();
});

test("EngineV never erases SIXEL slots outside the gallery viewport", () => {
  const viewport = { x: 20, y: 14, width: 100, height: 24 };
  const slots = resolveSixelImageSlots(viewport, 4, 24, 8, 13, 12);
  expect(slots.length).toBeGreaterThan(0);
  for (const slot of slots) {
    expect(slot.x).toBeGreaterThanOrEqual(viewport.x);
    expect(slot.y).toBeGreaterThanOrEqual(viewport.y);
    expect(slot.x + slot.width).toBeLessThanOrEqual(
      viewport.x + viewport.width,
    );
    expect(slot.y + slot.height).toBeLessThanOrEqual(
      viewport.y + viewport.height,
    );
  }
});
