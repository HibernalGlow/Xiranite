#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  nodeCliName,
  runGuidedInteraction,
  writeError,
  writeJson,
  writeLine,
  type CliCommand,
  type CliHost,
} from "@xiranite/cli-runtime";
import type { NodeRunResult } from "@xiranite/contract";
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
  updateNodeConfigFile,
} from "@xiranite/config";
import {
  runSoundw,
  type SoundwData,
  type SoundwInput,
  type SoundwRuntime,
} from "./core.js";
import { createSoundwInteractionSchema } from "./interaction.js";
import { help } from "./help.js";
import { createNodeSoundwRuntime } from "./platform.js";

const CLI_NAME = nodeCliName("soundw");
interface SoundwNodeConfig extends CliInteractionPreferencesSource {
  sound_switch_path?: string;
  profile_name?: string;
}
interface SoundwDefaults {
  soundSwitchPath?: string;
  profileName?: string;
}
export interface SoundwCliDependencies {
  createRuntime: () => SoundwRuntime;
  runGuide: typeof runGuidedInteraction;
  runUi: typeof runTerminalUi;
}
const defaults: SoundwCliDependencies = {
  createRuntime: createNodeSoundwRuntime,
  runGuide: runGuidedInteraction,
  runUi: runTerminalUi,
};

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Switch SoundSwitch recording devices and microphone mute.",
  run: (args, host) => runProgram(args, host),
};
export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createHost(),
  dependencies: SoundwCliDependencies = defaults,
): Promise<void> {
  await runInteractionCli({
    args,
    host,
    cliName: CLI_NAME,
    loadContext: () => loadContext(host, true),
    createDefinition: (context, language) =>
      createDefinition(context, language, dependencies),
    runGuide: dependencies.runGuide,
    runUi: dependencies.runUi,
    loadScreen: async () => (await import("./Tui.js")).SoundwTui,
    createPreferences: (_context, values) => createPreferences(host, values),
    reexecEntrypoint: process.argv[1],
    help,
    runPipe: (pipeArgs, pipeHost) => runPipe(pipeArgs, pipeHost, dependencies),
  });
}
async function loadContext(host: CliHost, json: boolean) {
  try {
    const { config } = await loadNodeConfigWithHints<SoundwNodeConfig>(
      "soundw",
      {
        cwd: host.cwd,
        env: host.env,
        hintSink: { stderr: host.stderr },
        jsonMode: json,
      },
    );
    const preferences = resolveInteractionPreferences(config);
    return {
      preferences,
      value: {
        soundSwitchPath: config?.sound_switch_path,
        profileName: config?.profile_name,
      },
    };
  } catch {
    return {
      preferences: resolveInteractionPreferences(undefined),
      value: { soundSwitchPath: undefined, profileName: undefined },
    };
  }
}
function createDefinition(
  context: SoundwDefaults,
  language: TerminalLanguage,
  dependencies: SoundwCliDependencies,
): TerminalInteractionDefinition<SoundwInput, NodeRunResult<SoundwData>> {
  return {
    schema: createSoundwInteractionSchema(
      {
        soundSwitchPath: context.soundSwitchPath,
        profileName: context.profileName,
      },
      language,
    ),
    run: (input, onEvent) =>
      runSoundw(input, dependencies.createRuntime(), onEvent),
  };
}
function createPreferences(
  host: CliHost,
  current: TerminalPreferenceValues,
): TerminalPreferenceController {
  const configOptions = { cwd: host.cwd, env: host.env };
  return {
    nodeId: "soundw",
    current,
    async save(values) {
      await updateNodeConfigFile("soundw", {
          cli: {
            theme: values.theme,
            default_mode: values.defaultMode,
            language: values.language,
          },
        }, configOptions);
    },
    async restore() {
      const context = await loadContext(host, true);
      return {
        theme: context.preferences.theme,
        defaultMode: context.preferences.mode,
        language:
          context.preferences.language ??
          resolveTerminalLanguage(undefined, host.env),
      };
    },
  };
}
async function runPipe(
  args: string[],
  host: CliHost,
  dependencies: SoundwCliDependencies,
) {
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    writeLine(
      host,
      `Usage:\n  ${CLI_NAME} ui [--lang zh|en] [--theme NAME]\n  ${CLI_NAME} gd\n  ${CLI_NAME} status|recording|mute|unmute|toggle|profiles|profile --profile NAME|settings [--path FILE] [--json]`,
    );
    return;
  }
  const command = args.find((value) => !value.startsWith("-"));
  const action =
    command === "recording"
      ? "switch-recording"
      : command === "toggle"
        ? "toggle-mute"
        : command === "profile"
          ? "profile"
          : command === "profiles"
            ? "profiles"
            : command === "mute"
              ? "mute"
              : command === "unmute"
                ? "unmute"
                : command === "settings"
                  ? "settings"
                  : command === "status"
                    ? "status"
                    : undefined;
  if (!action) {
    writeError(
      host,
      `Unknown SoundW command: ${command ?? ""}. Use \`${CLI_NAME} --help\`.`,
    );
    process.exitCode = 2;
    return;
  }
  const json = args.includes("--json");
  const context = await loadContext(host, json);
  const path = valueFor(args, "--path") ?? context.value.soundSwitchPath;
  const profileName = valueFor(args, "--profile") ?? context.value.profileName;
  const result = await runSoundw(
    { action, soundSwitchPath: path, profileName },
    dependencies.createRuntime(),
    (event) => {
      if (!json && event.message) writeLine(host, event.message);
    },
  );
  if (json) writeJson(host, result);
  else
    writeLine(
      host,
      result.success ? result.data?.output || result.message : result.message,
    );
  if (!result.success) process.exitCode = 1;
}
function valueFor(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
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
