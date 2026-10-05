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
  updateNodeConfigFile,
} from "@xiranite/config/node";
import {
  createOperationsClient,
  extractHostAttachArgs,
  sharedHostHandle,
  stopSharedHost,
} from "@xiranite/cli-runtime/backend";
import type {
  HostAttachFlag,
  HostHandle,
  OperationEvent,
  OperationsClient,
} from "@xiranite/cli-runtime/backend";
import type {
  TimeuAction,
  TimeuData,
  TimeuInput,
  TimeuResult,
} from "./core.js";
import {
  createTimeuInteractionSchema,
  type TimeuInteractionValues,
} from "./interaction.js";
import { help } from "./help.js";

const CLI_NAME = nodeCliName("timeu");
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "timeu";
interface TimeuConfig extends CliInteractionPreferencesSource {
  record_path?: string;
  recursive?: boolean;
  include_directories?: boolean;
  dry_run?: boolean;
}
type TimeuDefaults = Pick<
  TimeuInteractionValues,
  "recordPath" | "recursive" | "includeDirectories" | "dryRun"
>;
/**
 * Only the two interactive renderers are injectable. The node engine is not: it lives in the host,
 * so there is no runtime factory to hand in any more (ADR-0074 §5) — tests attach a scripted
 * `/operations` server through the host env instead.
 */
export interface TimeuCliDependencies {
  runGuide: typeof runGuidedInteraction;
  runUi: typeof runTerminalUi;
}
const defaults: TimeuCliDependencies = {
  runGuide: runGuidedInteraction,
  runUi: runTerminalUi,
};
export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Back up and restore file timestamps.",
  run: (args, host) => runProgram(args, host),
};
export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createHost(),
  dependencies: TimeuCliDependencies = defaults,
) {
  // The attach flags belong to the face, not to the node: they leave argv before the pipe router
  // sees them and are folded into the host env, so one object carries the attach for the whole
  // invocation and the flags can never reach a timeu input document.
  const attach = extractHostAttachArgs(args);
  const attachedHost = withAttachFlags(host, attach.flags);

  // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this
  // invocation, so it stops with it. An attached host is left exactly where it was.
  try {
    await runInteractionCli({
      args: attach.remaining,
      host: attachedHost,
      cliName: CLI_NAME,
      loadContext: () => context(attachedHost, true),
      createDefinition: (value, language) =>
        createTimeuHostDefinition(attachedHost, value, language),
      runPipe: (pipeArgs, pipeHost) => runPipe(pipeArgs, pipeHost),
      runGuide: async (definition, options) => {
        if (!(await hostReady(attachedHost))) return;
        await dependencies.runGuide(definition, options);
      },
      // The TUI form is the product, but opening it without a host would let the operator fill in
      // the whole ledger screen before the first dead end, so the host is resolved first.
      runUi: async (definition, options) => {
        if (!(await hostReady(attachedHost))) return;
        await dependencies.runUi(definition, options);
      },
      loadScreen: async () => (await import("./Tui.js")).TimeuTui,
      createPreferences: (_value, values) => preferences(attachedHost, values),
      reexecEntrypoint: process.argv[1],
      help,
    });
  } finally {
    await stopSharedHost();
  }
}

/**
 * Folds `--backend`/`--token`/`--channel-file` into the host env, which is where
 * `@xiranite/cli-runtime/backend` reads them as its second and third resolution steps; a flag
 * therefore outranks a real environment value.
 */
function withAttachFlags(
  host: CliHost,
  flags: Partial<Record<HostAttachFlag, string>>,
): CliHost {
  const env = { ...host.env };
  if (flags.backend) env.XIRANITE_BACKEND_URL = flags.backend;
  if (flags.token) env.XIRANITE_BACKEND_TOKEN = flags.token;
  if (flags.channelFile) env.XIRANITE_CHANNEL_FILE = flags.channelFile;
  return { ...host, env };
}

/**
 * The host for this face process, resolved once (ADR-0074 §6): attach to a host that is already
 * running, or start one as our own child when the operator configured nothing. The memo itself
 * lives in `@xiranite/cli-runtime`, because host lifecycle is a terminal concern and not each
 * node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd });
}

/**
 * True when a host is ready. The reason is written to this face's error line (it already names
 * every way to attach and says when no host binary was found), so interactive callers only have to
 * stop before drawing anything.
 */
async function hostReady(host: CliHost): Promise<boolean> {
  try {
    await resolveHostHandle(host);
    return true;
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return false;
  }
}

/** A client bound to the resolved host, or a rejection naming what is missing. */
async function hostOperationsClient(host: CliHost): Promise<OperationsClient> {
  const handle = await resolveHostHandle(host);
  return createOperationsClient({
    baseUrl: handle.attachment.baseUrl,
    token: handle.attachment.token,
  });
}

/**
 * Attaches to the host, runs one timeu operation and returns its result document, or `undefined`
 * when the attach or the transport failed — reported on this face's error line with exit code 1.
 * A terminal face that cannot reach a host stops rather than running `core.ts` locally: that
 * fallback is the compat path ADR-0074 §5 removes, and `HostAttachmentError` names every way to
 * get a host. A run that simply did not work is a result with `success: false`, not a throw.
 */
async function runTimeuOnHost(
  host: CliHost,
  input: TimeuInput & { action: TimeuAction },
  onEvent?: (event: OperationEvent) => void,
): Promise<TimeuResult | undefined> {
  try {
    const client = await hostOperationsClient(host);
    return await client.runOperation<TimeuData>(NODE_ID, input, onEvent);
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return undefined;
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema; the run and
 * the control calls go to the host, and the started record is kept so cancel, pause and resume
 * address the operation this face actually started.
 */
export function createTimeuHostDefinition(
  host: CliHost,
  value: TimeuDefaults,
  language: TerminalLanguage,
): TerminalInteractionDefinition<TimeuInput, TimeuResult> {
  const schema = createTimeuInteractionSchema(value, language);
  let running: { client: OperationsClient; operationId: string } | undefined;
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host);
      const started = await client.startOperation<TimeuData>(NODE_ID, input);
      running = { client, operationId: started.operationId };
      try {
        return await client.awaitOperation<TimeuData>(started, onEvent);
      } finally {
        running = undefined;
      }
    },
    pause: async () => {
      if (running) await running.client.pauseOperation(running.operationId);
    },
    resume: async () => {
      if (running) await running.client.resumeOperation(running.operationId);
    },
    cancel: async () => {
      if (running) await running.client.cancelOperation(running.operationId);
    },
  };
}

async function context(host: CliHost, json: boolean) {
  try {
    const { config } = await loadNodeConfigWithHints<TimeuConfig>("timeu", {
      cwd: host.cwd,
      env: host.env,
      hintSink: { stderr: host.stderr },
      jsonMode: json,
    });
    return {
      preferences: resolveInteractionPreferences(config),
      value: {
        recordPath: config?.record_path ?? "",
        recursive: config?.recursive ?? true,
        includeDirectories: config?.include_directories ?? false,
        dryRun: config?.dry_run ?? true,
      },
    };
  } catch {
    return {
      preferences: resolveInteractionPreferences(undefined),
      value: {
        recordPath: "",
        recursive: true,
        includeDirectories: false,
        dryRun: true,
      },
    };
  }
}
function preferences(
  host: CliHost,
  current: TerminalPreferenceValues,
): TerminalPreferenceController {
  const configOptions = { cwd: host.cwd, env: host.env };
  return {
    nodeId: "timeu",
    current,
    async save(values) {
      await updateNodeConfigFile("timeu", {
          cli: {
            theme: values.theme,
            default_mode: values.defaultMode,
            language: values.language,
          },
        }, configOptions);
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
async function runPipe(args: string[], host: CliHost) {
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    writeLine(
      host,
      `Usage:\n  ${CLI_NAME} ui [--lang zh|en] [--theme NAME]\n  ${CLI_NAME} gd\n  ${CLI_NAME} scan|backup|restore PATH... [--record FILE] [--no-recursive] [--include-directories] [--dry-run] [--json]`,
    );
    return;
  }
  const action =
    args[0] === "backup" || args[0] === "restore"
      ? args[0]
      : args[0] === "scan"
        ? "scan"
        : undefined;
  if (!action) {
    writeError(
      host,
      `Unknown TimeU command: ${args[0] ?? ""}. Use \`${CLI_NAME} --help\`.`,
    );
    process.exitCode = 2;
    return;
  }
  const json = args.includes("--json");
  const loaded = await context(host, json);
  let paths = args
    .slice(1)
    .filter(
      (arg, index, all) =>
        !arg.startsWith("--") && all[index - 1] !== "--record",
    );
  if (paths.includes("-"))
    paths = paths
      .filter((path) => path !== "-")
      .concat(await readStdinLines(host.stdin));
  const result = await runTimeuOnHost(
    host,
    {
      action,
      paths,
      recordPath: valueFor(args, "--record") ?? loaded.value.recordPath,
      recursive: !args.includes("--no-recursive"),
      includeDirectories: args.includes("--include-directories"),
      dryRun: args.includes("--dry-run") || loaded.value.dryRun,
    },
    (event) => {
      if (!json && event.message) writeLine(host, event.message);
    },
  );
  if (!result) return;
  if (json) writeJson(host, result);
  else writeLine(host, result.message);
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
