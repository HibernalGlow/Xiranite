/**
 * The fixture trees `scripts/make-dissolvef-fixtures.ts` writes.
 *
 * Split into its own file because the interesting part of a fixture is *why* it exists: every entry names
 * the behaviour it is meant to exercise in `tests`, and `packages/nodes/dissolvef/src/core.ts` is what those
 * behaviours are read from. Adding a case here is the cheap way to drive a new one in the CLI, the TUI or
 * the GUI without inventing a one-off directory on the command line.
 *
 * `dirs` are created first and are deliberately allowed to contain nothing — that is the whole point of the
 * nested cases: a folder that stays empty after the move is the folder `dissolvef` deletes, so a fixture
 * that needed a file to exist would not test it.
 */

export interface FixtureTree {
  /** Directory name under `artifacts/dissolvef-fixtures/`, and the name `--only`/`--print-path` take. */
  name: string
  /** One line: what a run against this tree is supposed to show. */
  tests: string
  dirs: string[]
  files: Record<string, string>
}

export const fixtures: FixtureTree[] = [
  {
    name: "nested-empty-deep",
    tests:
      "nested 模式四级深 + 每级都留空目录：文件上移后 d/e/f 三个空目录应当被逐级删掉（这是你要的那种嵌套空文件夹）",
    dirs: ["a/b/c/d", "a/b/c/e", "a/f", "a/g/h"],
    files: { "a/b/c/d/deep.txt": "deep", "a/b/c/e/other.txt": "other", "a/f/top.txt": "top" },
  },
  {
    name: "empty-only",
    tests: "整棵树一个文件都没有，只有空目录：验证 nested/media/archive 不炸、不误删、结果计数全 0",
    dirs: ["x", "y/z", "y/w", "empty"],
    files: {},
  },
  {
    name: "nested-empty-and-file",
    tests: "同级混一个本来就空目录 + 一个文件在两层深：只应塌掉被清空的那条链，空兄弟保留还是删掉是可见判定",
    dirs: ["box/sub/one", "box/sub/two", "box/sub/three/four"],
    files: { "box/sub/one/1.txt": "one", "box/top.txt": "top" },
  },
  {
    name: "name-conflict",
    tests: "子层文件与父层同名（a.txt / folder/a.txt）：fileConflict 的 auto/skip/overwrite/rename 四种都要在这里可试",
    dirs: ["folder", "folder/inner"],
    files: { "a.txt": "parent version", "folder/a.txt": "child version", "folder/b.txt": "b" },
  },
  {
    name: "media-archive-mix",
    tests: "archive/media/collect_archives 与相似度阈值：series_a 名字对得上、alpha/beta.zip 对不上、series_c 是空目录",
    dirs: ["series_a", "series_b", "alpha", "series_c"],
    files: {
      "series_a/series_a.zip": "zip",
      "series_a/series_a.mkv": "video",
      "series_b/series_b.zip": "zip",
      "series_b/readme.txt": "extra",
      "alpha/beta.zip": "zip",
    },
  },
  {
    name: "blacklist-and-protected",
    tests: "skipBlacklist 与 protectFirstLevel：keepme 命中黑名单、deep 下两级嵌套带空目录，第一层不能被拆",
    dirs: ["keepme", "deep/1", "deep/1/2", "deep/1/3", "deep/4"],
    files: { "keepme/inner.txt": "leave me", "deep/1/2/2.txt": "movable", "deep/4/4.txt": "movable too" },
  },
  {
    name: "unicode-and-spaces",
    tests: "中文目录名 + 带空格的路径 + 非 ASCII 文件名：授权根解析、rename 冲突计数、locale 差异都在这棵树上看",
    dirs: ["中文/第 1 层", "中文/第 2 层/里面", "spaces in name/sub dir"],
    files: {
      "中文/第 1 层/第一.txt": "one",
      "中文/第 2 层/里面/深的一层.txt": "deep",
      "spaces in name/sub dir/note.txt": "ascii content, non-ascii-free",
    },
  },
]
