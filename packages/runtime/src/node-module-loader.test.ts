import { spawn } from "node:child_process"
import { expect, test } from "vitest"

test("explicitly invalidates development source module revisions", async () => {
  const moduleUrl = new URL("./node-module-loader.ts", import.meta.url).href
  const script = `
    const loaderModule = await import(${JSON.stringify(moduleUrl)});
    const loader = loaderModule.createNodeModuleLoader(
      async () => ({}),
      { nodeId: "neoview", entry: "platform" },
    );
    const before = loader.getRevision();
    const invalidated = loaderModule.invalidateDevelopmentSourceModules();
    const after = loader.getRevision();
    console.log(JSON.stringify({ before, invalidated, after }));
  `
  const child = spawn(
    process.execPath,
    ["--eval", script],
    {
      env: {
        ...process.env,
        XIRANITE_NODE_SOURCE: "1",
        XIRANITE_NODE_SOURCE_HMR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    new Promise<number>((resolve, reject) => {
      child.on("error", reject)
      child.on("close", (code, signal) => resolve(code ?? (signal === null ? 1 : 128)))
    }),
    readText(child.stdout),
    readText(child.stderr),
  ])

  expect(stderr).toBe("")
  expect(exitCode).toBe(0)
  expect(JSON.parse(stdout)).toEqual({ before: 0, invalidated: true, after: 1 })
})

async function readText(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (stream === null) return ""
  stream.setEncoding("utf8")
  let text = ""
  for await (const chunk of stream as AsyncIterable<string>) text += chunk
  return text
}
