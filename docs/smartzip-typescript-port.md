# SmartZip TypeScript port

## Source of truth

- Upstream: <https://github.com/vvyoko/SmartZip>
- Local source snapshot: `D:/1VSCODE/Projects/LazyCommand/SmartZip/SmartZip.ahk`
- Upstream license: MIT

SmartZip is not an executable launcher. Its source defines the archive workflow:
multipart filtering, password attempts, output-directory selection, flattening a
single extracted item, collision-safe names, nested extraction, post-extraction
rename/delete rules, smart open, and per-folder archive creation.

The Xiranite node ports that workflow to TypeScript. It must never ask for a
`SmartZip.exe`, `SmartZip.ahk`, or `AutoHotkey.exe` path.

## Archive backend and filename encoding

- Workflow decisions and file post-processing live in TypeScript.
- Archive reading and writing consistently use an automatically discovered
  7-Zip installation. There is only one archive backend to maintain.
- The codepage action passes an explicit `-mcp` value to 7-Zip. Supported UI
  choices are CP936/GBK, CP950/Big5, CP932/Shift_JIS, CP949/EUC-KR, and
  CP65001/UTF-8.
- SmartZip.exe and AutoHotkey are not runtime dependencies and are never
  user-configured paths.
- Nested archives are detected by 7-Zip content probing, not only by filename
  extension. Renamed layers such as `.data` or `.bin` remain extractable, and
  every nested layer retries the configured password list. Recursion is capped
  at 32 layers as a malformed-archive safety boundary.

## Regression requirements

- Test the generated 7-Zip arguments for Chinese, Traditional Chinese,
  Japanese, Korean, and UTF-8 filename code pages.
- Run the real integration fixture containing three archive layers, encrypted
  inner ZIPs, an intervening directory, misleading `.data`/`.bin` names, and a
  Chinese/Japanese payload.
- Never persist or display plaintext archive passwords in command plans or run
  records.
- Reject archive entries that attempt path traversal.
- Preserve `pipe`, `gd`, and `ui` interaction modes.
- Keep `src/nodes/__backup__` untouched.
