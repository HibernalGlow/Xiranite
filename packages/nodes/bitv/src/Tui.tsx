/* @jsxImportSource @opentui/react */
import { useState } from "react";
import {
  ActionTabs,
  ProgressBar,
  resolveTerminalTheme,
  TerminalThemeProvider,
  terminalIcon,
  useAnimation,
  useTerminalTheme,
  useTerminalUiSession,
  WorkbenchButton,
  WorkbenchField,
  useTerminalChromeActions,
  WorkbenchPanel,
} from "@xiranite/cli-runtime/terminal/opentui";
import type { TerminalUiScreenProps } from "@xiranite/cli-runtime/terminal";
import { createTerminalTranslator } from "@xiranite/cli-runtime/i18n";
import type { BitvInput, BitvResult } from "./core.js";
export function BitvTui(props: TerminalUiScreenProps<BitvInput, BitvResult>) {
  const [name, setName] = useState(props.theme ?? "inherit");
  return (
    <TerminalThemeProvider
      theme={resolveTerminalTheme(name === "inherit" ? "nord" : name)}
    >
      <BitvWorkbench {...props} />
    </TerminalThemeProvider>
  );
}
function BitvWorkbench({
  definition,
  language,
  onExit,
}: TerminalUiScreenProps<BitvInput, BitvResult>) {
  const theme = useTerminalTheme();
  const t = createTerminalTranslator(language);
  const session = useTerminalUiSession(definition);
  useTerminalChromeActions({ onReset: session.reset, onExit });
  const frame = useAnimation({
    intervalMs: session.phase === "running" ? 110 : 480,
  });
  const source = session.fields.filter((field) =>
    [
      "paths",
      "reportPath",
      "recursive",
      "bitrateStepMbps",
      "maxLevels",
    ].includes(field.id),
  );
  const output = session.fields.filter((field) =>
    ["outputPath", "targetPath", "transferMode", "dryRun"].includes(field.id),
  );
  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      <box
        height={4}
        borderStyle="single"
        borderColor={theme.colors.border}
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={1}
        paddingRight={1}
      >
        <box flexDirection="column">
          <text fg={theme.colors.primary}>
            <b>{`${terminalIcon("status")} BITV // BITRATE OBSERVATORY`}</b>
          </text>
          <text fg={theme.colors.mutedForeground}>
            {language === "zh"
              ? "视频分析、分级与安全分类"
              : "Video analysis, bitrate levels and safe classification"}
          </text>
        </box>
        <text fg={theme.colors.primary}>
          {["⠁", "⠂", "⠄", "⡀", "⢀"][frame % 5]}
        </text>
      </box>
      <box flexDirection="row" flexGrow={1} minHeight={0} gap={1} marginTop={1}>
        <WorkbenchPanel
          title={language === "zh" ? "视频来源" : "Video sources"}
          width="34%"
        >
          <ActionTabs
            id="field-action"
            options={[
              { value: "status", label: "◉ 状态" },
              { value: "analyze", label: "⌕ 分析" },
              { value: "classify", label: "▤ 分类" },
              { value: "report", label: "▣ 报告" },
            ]}
            value={session.values.action}
            focused={session.focusedControlId === "action"}
            onFocus={() => session.focus("action")}
            onChange={(value) => session.setField("action", value)}
          />
          <scrollbox flexGrow={1}>
            {source.map((field) => (
              <WorkbenchField
                key={field.id}
                field={field}
                value={session.values[field.id]}
                error={session.fieldErrors[field.id]}
                focused={session.focusedControlId === field.id}
                t={t}
                onFocus={() => session.focus(field.id)}
                onChange={(value) => session.setField(field.id, value)}
              />
            ))}
          </scrollbox>
        </WorkbenchPanel>
        <WorkbenchPanel
          title={language === "zh" ? "码率图谱" : "Bitrate map"}
          flexGrow={1}
        >
          <box flexDirection="column" flexGrow={1}>
            <ascii-font
              text={session.phase === "running" ? "SCAN" : "BITV"}
              font="tiny"
              color={[theme.colors.primary, theme.colors.focusRing]}
            />
            <scrollbox flexGrow={1}>
              {session.resultSummary?.table?.rows.map((row, index) => (
                <text
                  key={`${row.file}-${index}`}
                  fg={theme.colors.mutedForeground}
                >{`▸ ${row.file}  ${row.bitrate}  ${row.level}`}</text>
              )) ??
                session.preview.map((line, index) => (
                  <text
                    key={`${line}-${index}`}
                  >{`${index ? "·" : "▸"} ${line}`}</text>
                ))}
            </scrollbox>
            <ProgressBar
              value={session.progress}
              label={session.status || "READY"}
            />
          </box>
        </WorkbenchPanel>
        <WorkbenchPanel
          title={language === "zh" ? "分类闸门" : "Classification gate"}
          width="27%"
        >
          <scrollbox flexGrow={1}>
            {output.map((field) => (
              <WorkbenchField
                key={field.id}
                field={field}
                value={session.values[field.id]}
                error={session.fieldErrors[field.id]}
                focused={session.focusedControlId === field.id}
                t={t}
                onFocus={() => session.focus(field.id)}
                onChange={(value) => session.setField(field.id, value)}
              />
            ))}
            {session.resultSummary?.lines.map((line, index) => (
              <text key={`${line}-${index}`}>{line}</text>
            ))}
          </scrollbox>
          <WorkbenchButton
            id="execute"
            danger={session.dangerous}
            onClick={() => void session.requestExecute()}
          >
            {session.dangerous ? "⚠ 确认后分类" : "▶ 执行"}
          </WorkbenchButton>
        </WorkbenchPanel>
      </box>
    </box>
  );
}
