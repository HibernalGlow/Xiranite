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
import type { SmartZipInput, SmartZipResult } from "./core.js";
export function SmartZipTui(
  props: TerminalUiScreenProps<SmartZipInput, SmartZipResult>,
) {
  const [name, setName] = useState(props.theme ?? "inherit");
  return (
    <TerminalThemeProvider
      theme={resolveTerminalTheme(name === "inherit" ? "nord" : name)}
    >
      <Workbench {...props} />
    </TerminalThemeProvider>
  );
}
function Workbench({
  definition,
  language,
  onExit,
}: TerminalUiScreenProps<SmartZipInput, SmartZipResult>) {
  const theme = useTerminalTheme();
  const t = createTerminalTranslator(language);
  const session = useTerminalUiSession(definition);
  useTerminalChromeActions({ onReset: session.reset, onExit });
  const frame = useAnimation({
    intervalMs: session.phase === "running" ? 120 : 500,
  });
  const paths = session.fields.filter((field) =>
    ["pathsText", "iniPath"].includes(field.id),
  );
  const config = session.fields.filter(
    (field) => !paths.includes(field) && field.id !== "action",
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
            <b>{`${terminalIcon("status")} SMARTZIP // ARCHIVE SWITCHBOARD`}</b>
          </text>
          <text fg={theme.colors.mutedForeground}>
            {language === "zh"
              ? "提取、压缩、打开与运行记录"
              : "Extract, archive, open and run history"}
          </text>
        </box>
        <text fg={theme.colors.primary}>
          {["⠁", "⠂", "⠄", "⡀", "⢀"][frame % 5]}
        </text>
      </box>
      <box flexDirection="row" flexGrow={1} minHeight={0} gap={1} marginTop={1}>
        <WorkbenchPanel
          title={language === "zh" ? "归档动作" : "Archive action"}
          width="29%"
        >
          <ActionTabs
            id="field-action"
            options={[
              { value: "status", label: "◉ 状态" },
              { value: "extract", label: "⇩ 提取" },
              { value: "extract_codepage", label: "⌘ 编码提取" },
              { value: "open", label: "↗ 打开" },
              { value: "archive", label: "▣ 压缩" },
              { value: "settings", label: "⚙ 设置" },
            ]}
            value={session.values.action}
            focused={session.focusedControlId === "action"}
            onFocus={() => session.focus("action")}
            onChange={(value) => session.setField("action", value)}
          />
          <scrollbox flexGrow={1}>
            {paths.map((field) => (
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
          title={language === "zh" ? "命令预览" : "Command preview"}
          flexGrow={1}
        >
          <ascii-font
            text={session.phase === "running" ? "ZIP" : "READY"}
            font="tiny"
            color={[theme.colors.primary, theme.colors.focusRing]}
          />
          <scrollbox flexGrow={1}>
            {session.preview.map((line, index) => (
              <text
                key={`${line}-${index}`}
                fg={
                  index ? theme.colors.mutedForeground : theme.colors.foreground
                }
              >{`${index ? "·" : "▸"} ${line}`}</text>
            ))}
            {session.resultSummary?.lines.map((line, index) => (
              <text key={`${line}-${index}`} fg={theme.colors.error}>
                {line}
              </text>
            ))}
          </scrollbox>
          <ProgressBar
            value={session.progress}
            label={session.status || "READY"}
          />
        </WorkbenchPanel>
        <WorkbenchPanel
          title={language === "zh" ? "配置闸门" : "Config gate"}
          width="29%"
        >
          <scrollbox flexGrow={1}>
            {config.map((field) => (
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
          <WorkbenchButton
            id="execute"
            danger={session.dangerous}
            onClick={() => void session.requestExecute()}
          >
            {session.dangerous ? "⚠ 确认后启动" : "▶ 运行"}
          </WorkbenchButton>
        </WorkbenchPanel>
      </box>
    </box>
  );
}
