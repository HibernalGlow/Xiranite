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

// Types only, on purpose (ADR-0074 §5): a value import of `runSmartZip` would put a second copy of the
// node's engine inside this face's process. The one implementation runs in the host's QuickJS realm.
import type {
  SmartZipAction,
  SmartZipData,
  SmartZipInput,
  SmartZipResult,
} from "./core.js";
import {
  createSmartZipInteractionSchema,
  type SmartZipInteractionValues,
} from "./interaction.js";
import { help } from "./help.js";
const CLI_NAME = nodeCliName("smartzip");
/** The node id the host keys its bundle and manifest under; the route is `/nodes/{id}/operations`. */
const NODE_ID = "smartzip";
interface Config extends CliInteractionPreferencesSource {
  ini_path?: string;
  passwords?: string[];
  code_page?: number;
  database_path?: string;
  record_run?: boolean;
  dry_run?: boolean;
}
type Defaults = Pick<
  SmartZipInteractionValues,
  | "iniPath"
  | "passwordsText"
  | "codePage"
  | "databasePath"
  | "recordRun"
  | "dryRun"
>;
export const cli: CliCommand = {
  name: CLI_NAME,
  description: "SmartZip archive workflow.",
  run: (args, host) => runProgram(args, host),
};
export async function runProgram(
  args = process.argv.slice(2),
  host: CliHost = createHost(),
) {
  // The attach flags belong to the face, not to the node: they leave argv before the pipe parser reads
  // positional archive paths, so `--backend <url>` can never be taken for a file to open.
  const attach = extractHostAttachArgs(args);
  const attachedHost = withAttachFlags(host, attach.flags);

  // ADR-0074 §5 makes the host lifecycle CLI work: a host this face started belongs to this invocation,
  // so it stops with it. An attached host is left exactly where it was (`stop()` is a no-op on it).
  try {
    await runInteractionCli({
      args: attach.remaining,
      host: attachedHost,
      cliName: CLI_NAME,
      loadContext: () => context(attachedHost, true),
      createDefinition: (value, language) =>
        createSmartZipHostDefinition(attachedHost, value, language),
      // Both interactive forms are the product, but opening them without a host would let the operator
      // fill in the whole workbench before the first dead end, so the host is resolved first.
      runGuide: async (definition, options) => {
        if (!(await hostReady(attachedHost))) return;
        await runGuidedInteraction(definition, options);
      },
      runUi: async (definition, options) => {
        if (!(await hostReady(attachedHost))) return;
        await runTerminalUi(definition, options);
      },
      loadScreen: async () => (await import("./Tui.js")).SmartZipTui,
      createPreferences: (_value, values) => preferences(attachedHost, values),
      reexecEntrypoint: process.argv[1],
      help,
      runPipe: (pipeArgs, pipeHost) => pipe(pipeArgs, pipeHost),
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
 * The host for this face process, resolved once: attach to a host that is already running, or start one
 * as our own child when the operator configured nothing. The memo lives in `@xiranite/cli-runtime`,
 * because host lifecycle is a terminal concern and not each node's to rewrite.
 */
function resolveHostHandle(host: CliHost): Promise<HostHandle> {
  return sharedHostHandle({ env: host.env, cwd: host.cwd });
}

/**
 * True when a host is ready. The reason goes to this face's error line (it already names every way to
 * attach and says when no host binary was found), so an interactive caller only has to stop before
 * drawing anything.
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
 * Attaches to the host, runs the operation and returns its result document, or `undefined` when the
 * attach or the transport failed — reported on this face's error line with exit code 1.
 * A terminal face that cannot reach a host stops rather than running `core.ts` locally: that fallback
 * is the compat path ADR-0074 §5 removes, and `HostAttachmentError` names every way to get a host.
 * Failures are caught here instead of thrown because citty's `runMain` answers a thrown error with
 * `process.exit(1)` and drops buffered stdout; setting `process.exitCode` keeps the codes this CLI uses
 * (1 failure, 2 usage) and leaves `--json` output clean. A run that simply did not work is a result
 * with `success: false`, not a throw.
 */
async function runSmartZipOnHost(
  host: CliHost,
  input: SmartZipInput & { action: SmartZipAction },
  onEvent?: (event: OperationEvent) => void,
): Promise<SmartZipResult | undefined> {
  try {
    const client = await hostOperationsClient(host);
    return await client.runOperation<SmartZipData>(NODE_ID, input, onEvent);
  } catch (error) {
    writeError(host, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return undefined;
  }
}

/**
 * The definition the `ui` and `gd` faces render. The node owns only the shared schema; the run and the
 * control calls go to the host, and the started record is kept so cancel, pause and resume address the
 * operation this face actually started.
 */
export function createSmartZipHostDefinition(
  host: CliHost,
  defaults: Defaults,
  language: TerminalLanguage,
): TerminalInteractionDefinition<SmartZipInput, SmartZipResult> {
  const schema = createSmartZipInteractionSchema(defaults, language);
  let running: { client: OperationsClient; operationId: string } | undefined;
  return {
    schema,
    run: async (input, onEvent) => {
      const client = await hostOperationsClient(host);
      const started = await client.startOperation<SmartZipData>(NODE_ID, input);
      running = { client, operationId: started.operationId };
      try {
        return await client.awaitOperation<SmartZipData>(started, onEvent);
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
        passwordsText: (config?.passwords ?? []).join("\n"),
        codePage: String(config?.code_page ?? 0),
        databasePath: config?.database_path ?? "",
        recordRun: config?.record_run ?? false,
        dryRun: config?.dry_run ?? true,
      },
    };
  } catch {
    return {
      preferences: resolveInteractionPreferences(undefined),
      value: {
        iniPath: "",
        passwordsText: "",
        codePage: "0",
        databasePath: "",
        recordRun: false,
        dryRun: true,
      },
    };
  }
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
      await updateNodeConfigFile("smartzip", {
          cli: {
            theme: values.theme,
            default_mode: values.defaultMode,
            language: values.language,
          },
        }, options);
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
async function pipe(args: string[], host: CliHost) {
  if (args.includes("--help") || args.includes("-h")) {
    writeLine(
      host,
      `Usage: ${CLI_NAME} ui|gd|status|cp|x|xc|o|a PATH... [--code-page auto|936|950|932|949|65001] [--dry-run] [--json]`,
    );
    return;
  }
  const action =
    args[0] === "cp"
      ? "inspect_codepage"
      : args[0] === "x"
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
  const codePage = readCodePageOption(args, "--code-page") ?? (Number(loaded.value.codePage) || 0);
  let paths = positionalPaths(args.slice(1), ["--code-page"]);
  if (paths.includes("-"))
    paths = paths
      .filter((path) => path !== "-")
      .concat(await readStdinLines(host.stdin));
  // One start call over `/nodes/smartzip/operations`, carrying the same input document this face used to
  // hand to the in-process runner; the host's realm is what executes it now.
  const result = await runSmartZipOnHost(
    host,
    {
      action,
      paths,
      ...loaded.value,
      passwords: loaded.value.passwordsText.split(/\r?\n/).map((password) => password.trim()).filter(Boolean),
      codePage,
      dryRun: args.includes("--dry-run") || loaded.value.dryRun,
    },
    json ? undefined : (event) => {
      if (event.message) writeLine(host, event.message);
    },
  );
  if (!result) return;
  if (json) writeJson(host, result);
  else writeLine(host, result.message);
  if (!result.success) process.exitCode = 1;
}
function readCodePageOption(args: string[], name: string): number | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  const index = args.indexOf(name);
  const value = inline ? inline.slice(name.length + 1) : index >= 0 ? args[index + 1] : undefined;
  if (value?.toLowerCase() === "auto") return 0;
  return value === undefined ? undefined : Number(value) || undefined;
}
function positionalPaths(args: string[], valueOptions: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (valueOptions.includes(arg)) { index += 1; continue; }
    if (arg.startsWith("--")) continue;
    result.push(arg);
  }
  return result;
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
