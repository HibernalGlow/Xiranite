export const CLI_NAME = "xfindz"

export async function runProgram(): Promise<void> {
  process.stdout.write("Findz v2 is available from the Xiranite workspace GUI.\n")
}

if (process.argv[1]?.endsWith("cli.js")) {
  void runProgram().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
