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
- Filename encoding inspection reads raw ZIP central-directory bytes without
  extracting the archive. It shows candidate previews for CP936/GBK,
  CP950/Big5, CP932/Shift_JIS, CP949/EUC-KR, and CP65001/UTF-8, including a
  confidence level. The user may accept the recommendation or choose another
  preview before the codepage action passes `-mcp` to 7-Zip.
- UTF-8 ZIP metadata is treated as certain. Pure-Han GBK/Big5 ambiguity is
  reported as low confidence instead of silently claiming certainty.
- Large archives are not loaded into memory for inspection: only the signature
  and a bounded central-directory tail are read. Native 7z archives are marked
  Unicode and do not require legacy ZIP codepage selection.
- The GUI manages an ordered, masked password list. Node-config passwords and
  legacy SmartZip.ini `[password]` entries are merged, while commands, results,
  and run records remain redacted. Creating, editing, deleting, or reordering a
  GUI password automatically persists the complete ordered list to
  `nodes.smartzip.passwords`; text edits are briefly debounced and serialized so
  rapid typing cannot overwrite a newer value with an older save.
- The same read-only inspection uses the password list to obtain archive member
  paths and renders them with the shared file-tree component. Missing or damaged
  multipart sets remain visible as tree roots with their concise 7-Zip error.
- SmartZip.exe and AutoHotkey are not runtime dependencies and are never
  user-configured paths.
- Nested archives are detected by 7-Zip content probing, not only by filename
  extension. Renamed layers such as `.data` or `.bin` remain extractable, and
  every nested layer retries the configured password list. Recursion is capped
  at 32 layers as a malformed-archive safety boundary.
- Directory input is expanded recursively. For split archives such as
  `name.7z.001`, only the first volume is scheduled; `.002` and later volumes,
  plus `.par2` recovery files, are not submitted as independent archives.
- Dry-run uses the same directory expansion as live execution, so its operation
  list contains the real first-volume tasks instead of a misleading
  `7z x <directory>` command.

## Regression requirements

- Test the generated 7-Zip arguments for Chinese, Traditional Chinese,
  Japanese, Korean, and UTF-8 filename code pages.
- Run the real integration fixture containing three archive layers, encrypted
  inner ZIPs, an intervening directory, misleading `.data`/`.bin` names, and a
  Chinese/Japanese payload.
- Run a real encrypted, header-encrypted, multi-volume 7z fixture through a
  directory input and assert that only `.7z.001` is scheduled.
- Never persist or display plaintext archive passwords in command plans or run
  records.
- Reject archive entries that attempt path traversal.
- Preserve `pipe`, `gd`, and `ui` interaction modes.
- Keep `src/nodes/__backup__` untouched.
