/* @jsxImportSource @opentui/react */
import { createServer, type AddressInfo, type IncomingHttpHeaders } from "node:http";
import { testRender } from "@opentui/react/test-utils";
import { expect, test, afterEach } from "vitest";
import { act } from "react";
import type { CliHost } from "@xiranite/cli-runtime";
import { createMigratefHostDefinition } from "./cli.js";
import { createMigratefInteractionSchema } from "./interaction.js";
import { MigratefTui } from "./Tui.js";
import type { MigratefResult } from "./core.js";

const HOST_TOKEN = "tui-host-token";
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

/**
 * The same gate with the *production* wiring: the real host definition from `cli.ts` and the real screen,
 * over a scripted `/operations` host. The claim being tested is ordering, not rendering — a dangerous
 * action must not reach `POST /nodes/migratef/operations` until the operator confirms, which is what keeps
 * `isDangerous`/`dangerPrompt` in front of the call after the run moved off this process (ADR-0074 §5).
 */
test("the host-backed definition asks before the undo reaches the host", async () => {
  const fake = await startFakeHost();
  hosts.push(fake);
  const face = createFaceHost(fake.baseUrl);
  const definition = createMigratefHostDefinition(face, undefined, "zh");
  const setup = await testRender(
    <MigratefTui definition={definition} language="zh" onExit={() => undefined} />,
    { width: 142, height: 38, useMouse: true },
  );
  try {
    await act(async () => setup.renderOnce());

    // Undo is dangerous on its own: selecting it must not start anything, and the session goes straight
    // to the confirmation instead of an `execute` button.
    const undo = setup.renderer.root.findDescendantById("action-undo");
    expect(undo).toBeDefined();
    await act(async () => setup.mockMouse.click(undo!.x + 2, undo!.y + 1));
    await act(async () => setup.flush());
    expect(fake.starts).toEqual([]);
    expect(setup.captureCharFrame()).toContain("↯ 确认迁移");

    const confirm = setup.renderer.root.findDescendantById("confirm-execute");
    expect(confirm).toBeDefined();
    await act(async () => setup.mockMouse.click(confirm!.x + 2, confirm!.y + 1));
    await setup.waitFor(() => fake.starts.length === 1);

    // One operation, addressed at the host, with the schema's own input document.
    expect(fake.starts[0]?.path).toBe("/nodes/migratef/operations");
    expect(fake.starts[0]?.input).toMatchObject({ action: "undo", dryRun: true });
    expect(fake.operationPaths[0]).toMatch(/^\/node-operations\/op-1\/stream$/);
  } finally {
    await act(async () => setup.renderer.destroy());
  }
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
 * A `/operations` host on real HTTP: it records the start calls, answers the token check the way
 * `crates/xiranite-api` does, and closes the NDJSON stream right after the result frame.
 */
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
        const result: MigratefResult = { success: true, message: "Undo completed", data: { plan: [], history: [], migratedCount: 0, skippedCount: 0, errorCount: 0, totalCount: 0, operationId: "", successCount: 0, failedCount: 0, errors: [] } };
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
  return { operationId, nodeId: "migratef", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra };
}

/** The non-TTY face the production definition factory attaches to the scripted host. */
function createFaceHost(baseUrl: string): CliHost {
  return {
    cwd: process.cwd(),
    env: {
      XIRANITE_BACKEND_URL: baseUrl,
      XIRANITE_BACKEND_TOKEN: HOST_TOKEN,
      XIRANITE_CONFIG_PATH: "/nonexistent/xiranite-migratef-tui.toml",
      XIRANITE_CLI_COLUMNS: "142",
      NO_COLOR: "1",
    },
    stdin: { isTTY: false } as CliHost["stdin"],
    stdout: { isTTY: false, columns: 142, write: () => true } as unknown as CliHost["stdout"],
    stderr: { isTTY: false, columns: 142, write: () => true } as unknown as CliHost["stderr"],
  };
}
