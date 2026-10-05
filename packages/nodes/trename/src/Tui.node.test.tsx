/* @jsxImportSource @opentui/react */
import { createServer, type AddressInfo, type IncomingHttpHeaders } from "node:http";
import { testRender } from "@opentui/react/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import { act } from "react";
import type { CliHost } from "@xiranite/cli-runtime";
import { createTrenameHostDefinition } from "./cli.js";
import { createTrenameInteractionSchema } from "./interaction.js";
import { flattenJsonTree, TrenameTui } from "./Tui.js";
import type { TrenameData, TrenameResult } from "./core.js";

const HOST_TOKEN = "tui-host-token";

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

  /**
   * The same screen with the *production* run — the host-backed `run`/`cancel` from `cli.ts` — over a
   * scripted `/operations` host. What is under test is ordering: trename is the face that moves files in
   * bulk, so a live rename must not reach `POST /nodes/trename/operations` until the operator has pressed
   * the danger confirmation, while a dry run must still go straight through.
   */
  test("a live rename asks the operator before the host is called", async () => {
    const fake = await startFakeHost();
    hosts.push(fake);
    const jsonContent = JSON.stringify({ root: [{ src: "一号.jpg", tgt: "ONE.jpg" }] });
    const definition = hostBackedDefinition(fake.baseUrl, { action: "rename", jsonContent, basePath: "/tmp/沙箱/重命名", dryRun: false });
    const setup = await testRender(<TrenameTui definition={definition} language="zh" onExit={() => undefined} />, { width: 150, height: 38, useMouse: true });
    try {
      await act(async () => setup.renderOnce());

      const execute = setup.renderer.root.findDescendantById("execute");
      expect(execute).toBeDefined();
      await act(async () => setup.mockMouse.click(execute!.x + 2, execute!.y + 1));
      await act(async () => setup.flush());
      // The review gate is on screen and the host has not been asked for anything.
      expect(setup.captureCharFrame()).toContain("⚠ 确认真实移动文件");
      expect(fake.starts).toEqual([]);

      const confirm = setup.renderer.root.findDescendantById("confirm-execute");
      expect(confirm).toBeDefined();
      await act(async () => setup.mockMouse.click(confirm!.x + 2, confirm!.y + 1));
      await setup.waitFor(() => fake.starts.length === 1);

      // One operation, over HTTP, with the rename JSON travelling verbatim and dryRun off.
      expect(fake.starts[0]?.path).toBe("/nodes/trename/operations");
      expect(fake.starts[0]?.input).toMatchObject({ action: "rename", jsonContent, basePath: "/tmp/沙箱/重命名", dryRun: false });
      expect(fake.operationPaths).toEqual(["/node-operations/op-1/stream"]);
    } finally { await act(async () => setup.renderer.destroy()); }
  });

  test("a dry run still reaches the host without a confirmation", async () => {
    const fake = await startFakeHost();
    hosts.push(fake);
    const jsonContent = JSON.stringify({ root: [{ src: "一号.jpg", tgt: "ONE.jpg" }] });
    const definition = hostBackedDefinition(fake.baseUrl, { action: "rename", jsonContent, basePath: "/tmp/沙箱/重命名", dryRun: true });
    const setup = await testRender(<TrenameTui definition={definition} language="zh" onExit={() => undefined} />, { width: 150, height: 38, useMouse: true });
    try {
      await act(async () => setup.renderOnce());
      const execute = setup.renderer.root.findDescendantById("execute");
      expect(execute).toBeDefined();
      await act(async () => setup.mockMouse.click(execute!.x + 2, execute!.y + 1));
      await setup.waitFor(() => fake.starts.length === 1);

      expect(setup.captureCharFrame()).not.toContain("⚠ 确认真实移动文件");
      expect(fake.starts[0]?.input).toMatchObject({ action: "rename", dryRun: true });
    } finally { await act(async () => setup.renderer.destroy()); }
  });
});

interface ScriptedHost {
  baseUrl: string;
  starts: { path: string; input: Record<string, unknown> }[];
  operationPaths: string[];
  close(): Promise<void>;
}

const hosts: ScriptedHost[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  process.exitCode = 0;
});

/**
 * Production run, node-owned schema: `createTrenameHostDefinition` is what `ui`/`gd` build, and the schema
 * is the node's own factory seeded the way the terminal's defaults allow. The screen never sees a local
 * `runTrename()` — the only `run` it holds posts to the host.
 */
function hostBackedDefinition(
  baseUrl: string,
  seed: Parameters<typeof createTrenameInteractionSchema>[0],
): ReturnType<typeof createTrenameHostDefinition> {
  const faceHost: CliHost = {
    cwd: process.cwd(),
    env: {
      XIRANITE_BACKEND_URL: baseUrl,
      XIRANITE_BACKEND_TOKEN: HOST_TOKEN,
      XIRANITE_CONFIG_PATH: "/nonexistent/xiranite-trename-tui.toml",
      XIRANITE_CLI_COLUMNS: "150",
      NO_COLOR: "1",
    },
    stdin: { isTTY: false } as CliHost["stdin"],
    stdout: { isTTY: false, columns: 150, write: () => true } as unknown as CliHost["stdout"],
    stderr: { isTTY: false, columns: 150, write: () => true } as unknown as CliHost["stderr"],
  };
  const production = createTrenameHostDefinition(faceHost, { enableUndo: true }, "zh");
  return { ...production, schema: createTrenameInteractionSchema(seed, "zh") };
}

/** A `/operations` host on real HTTP: token-checked, NDJSON-streamed, answered from `crates/xiranite-api`'s shape. */
async function startFakeHost(): Promise<ScriptedHost> {
  const starts: { path: string; input: Record<string, unknown> }[] = [];
  const operationPaths: string[] = [];

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
      if (request.method === "POST" && path.endsWith("/operations")) {
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8")).input as Record<string, unknown>;
        starts.push({ path, input });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ operation: record("op-1", "queued") }));
        return;
      }
      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path);
      if (stream?.[1]) {
        operationPaths.push(path);
        const data: TrenameData = {
          jsonContent: "", segments: [], totalItems: 1, pendingCount: 0, readyCount: 1,
          successCount: 1, failedCount: 0, skippedCount: 0, operationId: "batch-1", conflicts: [],
          operations: [{ originalPath: "/tmp/沙箱/重命名/一号.jpg", newPath: "/tmp/沙箱/重命名/ONE.jpg" }],
          history: [], basePath: "/tmp/沙箱/重命名", errors: [],
        };
        const result: TrenameResult = { success: true, message: "Rename completed", data };
        const frames = [
          { type: "operation", operation: record(stream[1], "running", { startedAt: 2 }) },
          { type: "result", operation: record(stream[1], "completed", { finishedAt: 4, result }), result },
        ];
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
        response.end(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`);
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Node operation not found." }));
    });
  });

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) });
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    starts,
    operationPaths,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => { server.close(() => resolve()) });
    },
  };
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "trename", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra };
}
