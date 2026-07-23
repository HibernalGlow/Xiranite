import { expect, test } from "bun:test"

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
  const child = Bun.spawn([process.execPath, "--eval", script], {
    env: {
      ...process.env,
      XIRANITE_NODE_SOURCE: "1",
      XIRANITE_NODE_SOURCE_HMR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  expect(stderr).toBe("")
  expect(exitCode).toBe(0)
  expect(JSON.parse(stdout)).toEqual({ before: 0, invalidated: true, after: 1 })
})
