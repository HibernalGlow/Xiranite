import { afterEach, describe, expect, test } from "vitest";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureCliMouseVisual,
  expectCliVisualArtifacts,
} from "../../../../scripts/cli-visual-testing.ts";

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url));
const HOST_TOKEN = "visual-token";
const PREVIEW_SOURCE = fileURLToPath(
  new URL(
    "../../../../ref/opentui/packages/examples/src/assets/forrest_background.png",
    import.meta.url,
  ),
);
const runs: string[] = [];
const hosts: { close(): Promise<void> }[] = [];
afterEach(async () => {
  process.exitCode = 0;
  for (const host of hosts.splice(0)) await host.close();
  await Promise.all(
    runs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

/**
 * The deck under capture is this node's own OpenTUI screen, which after ADR-0074 §5 asks a host to scan. It
 * gets this scripted one over `/operations` rather than the compiled Rust host: what is captured is the
 * gallery and its image slots, and a visual test must not depend on a host binary or on the machine's
 * attach environment. `/health` is answered token-free because that is the one route the host serves
 * without the bearer token, and the face probes it before it draws anything.
 *
 * The wallpaper rows point at the fixture folders on disk, so the preview images the deck decodes are the
 * same files the in-process face used to find itself.
 */
async function startFakeHost(
  workshop: string,
  items: readonly (readonly [string, string, string])[],
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const wallpapers = items.map(([id, title, type]) => ({
    path: join(workshop, id),
    folderName: id,
    workshopId: id,
    title,
    description: "Animated workshop preview",
    contentRating: "Everyone",
    ratingSex: "",
    ratingViolence: "",
    tags: ["Nature"],
    fileName: "project.json",
    preview: "preview.png",
    wallpaperType: type,
    createdTime: "2024-01-01",
    modifiedTime: "2024-01-02",
    size: 4096,
    projectData: {},
  }));
  // `runScan` returns the same list twice — nothing is filtered — and the deck renders that document.
  const result = {
    success: true,
    message: `Scan complete: ${wallpapers.length} wallpaper(s).`,
    data: {
      wallpapers,
      filteredWallpapers: wallpapers,
      totalCount: wallpapers.length,
      filteredCount: wallpapers.length,
      successCount: wallpapers.length,
      failedCount: 0,
      typeStats: { Scene: 2, Video: 2 },
      ratingStats: { Everyone: wallpapers.length },
      renameResults: [],
      deleteResults: [],
      exportPath: "",
      errors: [],
    },
  };
  const record = (operationId: string, phase: string) => ({
    operationId,
    nodeId: "enginev",
    phase,
    createdAt: 1,
    updatedAt: 2,
    eventCount: 0,
  });
  const byOperation = new Map<string, typeof result>();
  let sequence = 0;

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? "";
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== HOST_TOKEN) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
        response.end("Unauthorized");
        return;
      }
      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(path)) {
        const operationId = `op-${(sequence += 1)}`;
        byOperation.set(operationId, result);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ operation: { ...record(operationId, "queued") } }));
        return;
      }
      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path);
      const scripted = stream?.[1] ? byOperation.get(stream[1]) : undefined;
      if (!stream || !scripted) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Node operation not found." }));
        return;
      }
      const finished = { ...record(stream[1], "completed"), finishedAt: 4, result: scripted };
      const frames = [
        { type: "operation", operation: { ...finished, phase: "running" } },
        { type: "event", index: 0, event: { type: "progress", progress: 100, message: "Scan complete." } },
        { type: "result", operation: finished, result: scripted },
      ];
      response.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

describe("EngineV OpenTUI visual capture", () => {
  test("scans a fixture and captures the image-capable wallpaper deck", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-enginev-tui-"));
    runs.push(root);
    const workshop = join(root, "workshop");
    const items = [
      ["101", "Forest Circuit", "Scene"],
      ["102", "Nord Harbor", "Video"],
      ["103", "Neon Garden", "Scene"],
      ["104", "Cloud Station", "Video"],
    ] as const;
    for (const [id, title, type] of items) {
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
    const fake = await startFakeHost(workshop, items);
    hosts.push(fake);
    const capture = await captureCliMouseVisual({
      nodeId: "enginev",
      cliPath: CLI_PATH,
      args: ["ui", "--lang", "zh"],
      artifactName: "wallpaper-deck",
      initialWaitFor: "ENGINEV // WALLPAPER DECK",
      steps: [{ clickText: "扫描工坊", waitForText: "Forest Circuit" }],
      env: {
        XIRANITE_CONFIG_PATH: config,
        XIRANITE_BACKEND_URL: fake.baseUrl,
        XIRANITE_BACKEND_TOKEN: HOST_TOKEN,
      },
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
