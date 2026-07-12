/* @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal";
import {
  ActionLauncher,
  ActionTabs,
  ExecutionActions,
  ProgressBar,
  TerminalThemeProvider,
  WorkbenchField,
  WorkbenchPanel,
  resolveTerminalTheme,
  terminalIcon,
  useAnimation,
  useTerminalChromeActions,
  useTerminalTheme,
  useTerminalUiSession,
} from "@xiranite/cli-runtime/terminal/opentui";
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n";
import type { FindzInput, FindzResult } from "./core.js";
export function FindzTui(p: TerminalUiScreenProps<FindzInput, FindzResult>) {
  const [x] = useState(p.theme ?? p.preferences?.current.theme ?? "nord");
  return (
    <TerminalThemeProvider
      theme={resolveTerminalTheme(x === "inherit" ? "nord" : x)}
    >
      <Desk {...p} />
    </TerminalThemeProvider>
  );
}
function Desk({
  definition,
  language,
  onExit,
}: TerminalUiScreenProps<FindzInput, FindzResult>) {
  const th = useTerminalTheme(),
    t = createTerminalTranslator(language),
    s = useTerminalUiSession(definition),
    f = useAnimation({ intervalMs: s.phase === "running" ? 75 : 500 }),
    d = s.result?.data,
    a = String(s.values.action ?? "search");
  useTerminalChromeActions({ onReset: s.reset, onExit });
  useKeyboard((k) => {
    if (k.name === "escape") onExit();
  });
  const field = (id: string) =>
    definition.schema.fields.find((x) => x.id === id)!;
  const F = ({ id, w }: { id: string; w?: `${number}%` }) => (
    <box width={w} flexGrow={w ? 0 : 1}>
      <WorkbenchField
        field={field(id)}
        value={s.values[id]}
        error={s.fieldErrors[id]}
        focused={s.focusedControlId === id}
        disabled={s.phase === "running"}
        t={t}
        onFocus={() => s.focus(id)}
        onChange={(v) => s.setField(id, v)}
      />
    </box>
  );
  const beam = ["⌕····", "·⌕···", "··⌕··", "···⌕·", "····⌕"][f % 5];
  const actions = field("action").options ?? [],
    help = actions.filter((x) => x.value === "help"),
    queries = actions.filter((x) => x.value !== "help");
  return (
    <box
      width="100%"
      height="100%"
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
      overflow="hidden"
    >
      <box
        height={4}
        borderStyle="single"
        borderColor={th.colors.border}
        paddingLeft={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <box flexDirection="column">
          <text fg={th.colors.primary}>
            <b>{`${terminalIcon("status")} FINDZ // ARCHIVE QUERY RADAR`}</b>
          </text>
          <text fg={th.colors.mutedForeground}>
            SQL-like 过滤 · 归档成员 · 分组精炼
          </text>
        </box>
        <text
          fg={s.phase === "running" ? th.colors.warning : th.colors.success}
        >{`${s.phase === "running" ? "SCANNING" : "QUERY READY"} ${beam}`}</text>
      </box>
      <box height={3} marginTop={1} flexDirection="row">
        <ActionTabs
          id="field-action"
          options={queries}
          value={a}
          focused={s.focusedControlId === "action"}
          disabled={s.phase === "running"}
          onFocus={() => s.focus("action")}
          onChange={(v) => s.setField("action", v)}
        />
        <ActionLauncher
          id="help-action"
          field={field("action")}
          options={help}
          session={s}
        />
      </box>
      <box height={7} flexDirection="row" gap={1}>
        <F id="paths" w="34%" />
        <F id="where" w="25%" />
        <F id="maxResults" w="20%" />
        <box
          width="18%"
          borderStyle="rounded"
          borderColor={th.colors.border}
          paddingLeft={1}
          flexDirection="column"
        >
          <text fg={th.colors.mutedForeground}>⌕ QUERY</text>
          <box flexGrow={1} />
          <ExecutionActions
            session={s}
            executeLabel="⌕ 执行查询"
            confirmLabel="⌕ 执行"
          />
        </box>
      </box>
      <box flexGrow={1} minHeight={0} marginTop={1} flexDirection="row" gap={1}>
        <WorkbenchPanel
          title={`结果表 · ${d?.returnedCount ?? 0}`}
          description="文件、目录与归档成员"
          width="48%"
        >
          <scrollbox flexGrow={1}>
            {d?.files.map((x, i) => (
              <text
                key={`${x.container}-${x.path}-${i}`}
                fg={
                  x.archive
                    ? th.colors.primary
                    : x.type === "dir"
                      ? th.colors.warning
                      : th.colors.foreground
                }
              >{`${x.archive ? "▣" : x.type === "dir" ? "▦" : "◇"} ${x.name}  ${x.sizeFormatted}`}</text>
            ))}
          </scrollbox>
        </WorkbenchPanel>
        <WorkbenchPanel
          title={`分组雷达 · ${d?.groups.length ?? 0}`}
          description="扩展名、归档与目录聚合"
          width="27%"
        >
          <scrollbox flexGrow={1}>
            {d?.groups.map((x, i) => (
              <text
                key={`${x.key}-${i}`}
                fg={th.colors.primary}
              >{`◎ ${x.name} · ${x.count} · ${x.totalSizeFormatted}`}</text>
            ))}
            {Object.entries(d?.byExtension ?? {})
              .slice(0, 12)
              .map(([ext, count]) => (
                <text
                  key={ext}
                  fg={th.colors.mutedForeground}
                >{`  ${ext || "(none)"} ${count}`}</text>
              ))}
          </scrollbox>
        </WorkbenchPanel>
        <WorkbenchPanel
          title="扫描遥测"
          description="索引、归档与错误"
          flexGrow={1}
        >
          <text>{`◇ 文件 ${d?.fileCount ?? 0}`}</text>
          <text>{`▦ 目录 ${d?.dirCount ?? 0}`}</text>
          <text>{`▣ 归档 ${d?.archiveCount ?? 0}`}</text>
          <text>{`▤ 嵌套 ${d?.nestedCount ?? 0}`}</text>
          <text fg={th.colors.error}>{`× 错误 ${d?.errors.length ?? 0}`}</text>
          <text
            fg={th.colors.mutedForeground}
          >{`${d?.elapsedMs ?? 0} ms · scanned ${d?.scannedFiles ?? 0}`}</text>
          <box flexGrow={1} />
          <ProgressBar value={s.progress} label={s.status || "READY"} />
        </WorkbenchPanel>
      </box>
    </box>
  );
}
