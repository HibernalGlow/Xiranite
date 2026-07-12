import { afterEach, describe, expect, test } from "vitest";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureCliMouseVisual,
  expectCliVisualArtifacts,
} from "../../../../scripts/cli-visual-testing.ts";

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url));
const PREVIEW_SOURCE = fileURLToPath(
  new URL(
    "../../../../ref/opentui/packages/examples/src/assets/forrest_background.png",
    import.meta.url,
  ),
);
const runs: string[] = [];
afterEach(async () => {
  process.exitCode = 0;
  await Promise.all(
    runs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("EngineV OpenTUI visual capture", () => {
  test("scans a fixture and captures the image-capable wallpaper deck", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-enginev-tui-"));
    runs.push(root);
    const workshop = join(root, "workshop");
    for (const [id, title, type] of [
      ["101", "Forest Circuit", "Scene"],
      ["102", "Nord Harbor", "Video"],
      ["103", "Neon Garden", "Scene"],
      ["104", "Cloud Station", "Video"],
    ] as const) {
      const item = join(workshop, id);
      await mkdir(item, { recursive: true });
      await copyFile(PREVIEW_SOURCE, join(item, "preview.png"));
      await writeFile(
        join(item, "project.json"),
        JSON.stringify({
          title,
          description: "Animated workshop preview",
          contentrating: "Everyone",
          type,
          preview: "preview.png",
          file: "scene.json",
          tags: ["Nature"],
        }),
        "utf8",
      );
      await writeFile(join(item, "scene.json"), "{}", "utf8");
    }
    const config = join(root, "xiranite.config.toml");
    await writeFile(
      config,
      `[nodes.enginev]\nworkshop_root = ${JSON.stringify(workshop.replace(/\\/g, "/"))}\nimage_backend = "half-block"\n`,
      "utf8",
    );
    const capture = await captureCliMouseVisual({
      nodeId: "enginev",
      cliPath: CLI_PATH,
      args: ["ui", "--lang", "zh"],
      artifactName: "wallpaper-deck",
      initialWaitFor: "ENGINEV // WALLPAPER DECK",
      steps: [{ clickText: "扫描工坊", waitForText: "Forest Circuit" }],
      env: { XIRANITE_CONFIG_PATH: config },
      columns: 128,
      rows: 42,
      viewport: { width: 1024, height: 900 },
      timeoutMs: 20_000,
    });
    expect(capture.plainText).toContain("Forest Circuit");
    expect(capture.plainText).toContain("Nord Harbor");
    expect(capture.plainText).toContain("Neon Garden");
    expect(capture.plainText).toContain("工坊图库");
    await expectCliVisualArtifacts(capture, 20_000);
  }, 40_000);
});
