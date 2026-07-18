import { runNodeFromMain } from "./nodeRunner.ts"

try {
  const input = await Bun.stdin.text()
  const payload = input.trim() ? JSON.parse(input) : {}
  const response = await runNodeFromMain(payload)
  process.stdout.write(JSON.stringify(response))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stdout.write(JSON.stringify({
    result: { success: false, message: `Node runner failed: ${message}` },
    events: [{ type: "log", message }],
  }))
}
