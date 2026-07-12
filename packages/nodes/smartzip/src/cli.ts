#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  nodeCliName,
  readStdinLines,
  runGuidedInteraction,
  writeError,
  writeJson,
  writeLine,
  type CliCommand,
  type CliHost,
} from "@xiranite/cli-runtime";
import {
  resolveInteractionPreferences,
  type CliInteractionPreferencesSource,
  type TerminalInteractionDefinition,
} from "@xiranite/cli-runtime/interaction";
import {
  resolveTerminalLanguage,
  type TerminalLanguage,
} from "@xiranite/cli-runtime/i18n";
import {
  runInteractionCli,
  runTerminalUi,
  type TerminalPreferenceController,
  type TerminalPreferenceValues,
} from "@xiranite/cli-runtime/terminal";
import {
  loadNodeConfigWithHints,
  loadXiraniteConfig,
  saveXiraniteConfig,
  updateNodeConfig,
} from "@xiranite/config";
import {
  runSmartZip,
  type SmartZipInput,
  type SmartZipResult,
  type SmartZipRuntime,
} from "./core.js";
import {
  createSmartZipInteractionSchema,
  type SmartZipInteractionValues,
} from "./interaction.js";
import { createNodeSmartZipRuntime } from "./platform.js";
import { help } from "./help.js";
const CLI_NAME = nodeCliName("smartzip");
interface Config extends CliInteractionPreferencesSource {
  ini_path?: string;
  database_path?: string;
  smartzip_exe?: string;
  smartzip_ahk?: string;
  autohotkey_exe?: string;
  record_run?: boolean;
  dry_run?: boolean;
}
type Defaults = Pick<
  SmartZipInteractionValues,
  | "iniPath"
  | "databasePath"
  | "smartZipExe"
  | "smartZipAhk"
  | "autohotkeyExe"
  | "recordRun"
  | "dryRun"
>;
export interface SmartZipCliDependencies {
  createRuntime: () => SmartZipRuntime;
  runGuide: typeof runGuidedInteraction;
  runUi: typeof runTerminalUi;
}
const dependencies: SmartZipCliDependencies = {
  createRuntime: createNodeSmartZipRuntime,
  runGuide: runGuidedInteraction,
  runUi: runTerminalUi,
};
export const cli: CliCommand = {
  name: CLI_NAME,
  description: "SmartZip archive workflow.",
  run: (args, host) => runProgram(args, host),
};
export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createHost(),
  deps: SmartZipCliDependencies = dependencies,
) {
  await runInteractionCli({
    args,
    host,
    cliName: CLI_NAME,
    loadContext: () => context(host, true),
    createDefinition: (value, language) => definition(value, language, deps),
    runGuide: deps.runGuide,
    runUi: deps.runUi,
    loadScreen: async () => (await import("./Tui.js")).SmartZipTui,
    createPreferences: (_value, values) => preferences(host, values),
    reexecEntrypoint: process.argv[1],
    help,
    runPipe: (pipeArgs, pipeHost) => pipe(pipeArgs, pipeHost, deps),
  });
}
async function context(host: CliHost, json: boolean) {
  try {
    const { config } = await loadNodeConfigWithHints<Config>("smartzip", {
      cwd: host.cwd,
      env: host.env,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    });
    return {
      preferences: resolveInteractionPreferences(config),
      value: {
        iniPath: config?.ini_path ?? "",
        databasePath: config?.database_path ?? "",
        smartZipExe: config?.smartzip_exe ?? "",
        smartZipAhk: config?.smartzip_ahk ?? "",
        autohotkeyExe: config?.autohotkey_exe ?? "AutoHotkey.exe",
        recordRun: config?.record_run ?? false,
        dryRun: config?.dry_run ?? true,
      },
    };
  } catch {
    return {
      preferences: resolveInteractionPreferences(undefined),
      value: {
        iniPath: "",
        databasePath: "",
        smartZipExe: "",
        smartZipAhk: "",
        autohotkeyExe: "AutoHotkey.exe",
        recordRun: false,
        dryRun: true,
      },
    };
  }
}
function definition(
  value: Defaults,
  language: TerminalLanguage,
  deps: SmartZipCliDependencies,
): TerminalInteractionDefinition<SmartZipInput, SmartZipResult> {
  return {
    schema: createSmartZipInteractionSchema(value, language),
    run: (input, onEvent) => runSmartZip(input, deps.createRuntime(), onEvent),
  };
}
function preferences(
  host: CliHost,
  current: TerminalPreferenceValues,
): TerminalPreferenceController {
  const options = { cwd: host.cwd, env: host.env };
  return {
    nodeId: "smartzip",
    current,
    async save(values) {
      const { config, path } = await loadXiraniteConfig(options);
      await saveXiraniteConfig(
        updateNodeConfig(config, "smartzip", {
          cli: {
            theme: values.theme,
            default_mode: values.defaultMode,
            language: values.language,
          },
        }),
        { ...options, configPath: path },
      );
    },
    async restore() {
      const loaded = await context(host, true);
      return {
        theme: loaded.preferences.theme,
        defaultMode: loaded.preferences.mode,
        language:
          loaded.preferences.language ??
          resolveTerminalLanguage(undefined, host.env),
      };
    },
  };
}
async function pipe(
  args: string[],
  host: CliHost,
  deps: SmartZipCliDependencies,
) {
  if (args.includes("--help") || args.includes("-h")) {
    writeLine(
      host,
      `Usage: ${CLI_NAME} ui|gd|status|x|xc|o|a PATH... [--dry-run] [--json]`,
    );
    return;
  }
  const action =
    args[0] === "x"
      ? "extract"
      : args[0] === "xc"
        ? "extract_codepage"
        : args[0] === "o"
          ? "open"
          : args[0] === "a"
            ? "archive"
            : args[0] === "status"
              ? "status"
              : undefined;
  if (!action) {
    writeError(host, `Unknown SmartZip command: ${args[0] ?? ""}.`);
    process.exitCode = 2;
    return;
  }
  const json = args.includes("--json");
  const loaded = await context(host, json);
  let paths = args.slice(1).filter((arg) => !arg.startsWith("--"));
  if (paths.includes("-"))
    paths = paths
      .filter((path) => path !== "-")
      .concat(await readStdinLines(host.stdin));
  const result = await runSmartZip(
    {
      action,
      paths,
      ...loaded.value,
      dryRun: args.includes("--dry-run") || loaded.value.dryRun,
    },
    deps.createRuntime(),
    (event) => {
      if (!json && event.message) writeLine(host, event.message);
    },
  );
  if (json) writeJson(host, result);
  else writeLine(host, result.message);
  if (!result.success) process.exitCode = 1;
}
function createHost(): CliHost {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  await runProgram().catch((error) => {
    writeError(
      createHost(),
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
