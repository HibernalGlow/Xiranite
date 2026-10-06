/**
 * `node:constants` — the flat constant module `require("constants")` hands out in Node (fs flags and access
 * bits, plus libuv dirent kinds, signal numbers, errno names, `RTLD_*`, `PRIORITY_*` and the OpenSSL flag set).
 *
 * Why it exists: `graceful-fs/polyfills.js` (bundled into ten retained platform closures) opens with
 * `var constants = require("constants")` and then feature-detects `constants.hasOwnProperty("O_SYMLINK")`
 * before it takes its `lchown`/`futimes` symlink path. The specifier had no shim module, so the whole bundle
 * kept an unmapped external (gate WARN).
 *
 * One table, two faces: the fs values live here and `fs.ts` re-exports the very same object as
 * `fs.constants`, so the two spellings cannot drift. The open flags are the platform split the package already
 * does (`POSIX_OPEN_FLAGS` / `WINDOWS_OPEN_FLAGS`, chosen from `__xrh.platform.platform`), because the delivery
 * host is Windows and a POSIX-only number baked into the bundle would be wrong there.
 *
 * What is deliberately **absent**, and why absence (not a throwing export) is the honest shape for a *value*:
 * - `O_SYMLINK`, `UV_FS_O_FILEMAP`, `O_SYNC`, `O_DSYNC`: platform-specific numbers whose only measured consumer
 *   feature-detects them, so an absent key makes `graceful-fs` skip the symlink-unsafe path exactly as it does on
 *   a platform without the flag. A throwing getter cannot be spelled as an ESM named export, and a placeholder
 *   number would be a wrong value handed to `fs.open`, which operations v1 does not have anyway.
 * - signal numbers (`SIGINT`, …), errno names (`EACCES`, …), `RTLD_*`, `PRIORITY_*`, `SSL_OP_*`,
 *   `UV_DIRENT_*`: the host owns these. Their numbers differ between Windows and POSIX, and the realm has no
 *   operation that accepts them, so the values would be inert at best and platform-wrong at worst. They are
 *   listed in `surface.ts` under `unsupported` with the host operation that would pin them
 *   (`__xrh.platform.constants`), never answered from a table copied off one machine.
 */
import { platformInfoOrFallback } from "./host.ts"

const POSIX_OPEN_FLAGS = {
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 0o100,
  O_EXCL: 0o200,
  O_NOCTTY: 0o400,
  O_TRUNC: 0o1000,
  O_APPEND: 0o2000,
  O_DIRECT: 0o40000,
  O_DIRECTORY: 0o200000,
  O_NOFOLLOW: 0o400000,
  O_NOATIME: 0o1000000,
  O_CLOEXEC: 0o2000000,
} as const

const WINDOWS_OPEN_FLAGS = {
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 0o200,
  O_EXCL: 0o400,
  O_NOCTTY: 0,
  O_TRUNC: 0o1000,
  O_APPEND: 8,
  O_DIRECT: 0,
  O_DIRECTORY: 0,
  O_NOFOLLOW: 0,
  O_NOATIME: 0,
  O_CLOEXEC: 0,
} as const

/** The split is the host's answer, not a build-time constant: the same bundle runs on either platform. */
const OPEN_FLAGS = platformInfoOrFallback().platform === "win32" ? WINDOWS_OPEN_FLAGS : POSIX_OPEN_FLAGS

/* --- Access / copyfile / mode bits: identical on every platform Node supports. --- */
export const F_OK = 0
export const R_OK = 4
export const W_OK = 2
export const X_OK = 1
export const COPYFILE_EXCL = 1
export const COPYFILE_FICLONE = 2
export const COPYFILE_FICLONE_FORCE = 4
export const S_IFMT = 0o170000
export const S_IFDIR = 0o040000
export const S_IFREG = 0o100644 & 0o170000
export const S_IFLNK = 0o120000
export const S_IFBLK = 0o060000
export const S_IFCHR = 0o020000
export const S_IFIFO = 0o010000
export const S_IFSOCK = 0o140000
export const S_IRUSR = 0o000400
export const S_IWUSR = 0o000200
export const S_IXUSR = 0o000100
export const S_IRGRP = 0o000040
export const S_IWGRP = 0o000020
export const S_IXGRP = 0o000010
export const S_IROTH = 0o000004
export const S_IWOTH = 0o000002
export const S_IXOTH = 0o000001

/* --- Open flags for the platform the host reported. --- */
export const O_RDONLY = OPEN_FLAGS.O_RDONLY
export const O_WRONLY = OPEN_FLAGS.O_WRONLY
export const O_RDWR = OPEN_FLAGS.O_RDWR
export const O_CREAT = OPEN_FLAGS.O_CREAT
export const O_EXCL = OPEN_FLAGS.O_EXCL
export const O_NOCTTY = OPEN_FLAGS.O_NOCTTY
export const O_TRUNC = OPEN_FLAGS.O_TRUNC
export const O_APPEND = OPEN_FLAGS.O_APPEND
export const O_DIRECT = OPEN_FLAGS.O_DIRECT
export const O_DIRECTORY = OPEN_FLAGS.O_DIRECTORY
export const O_NOFOLLOW = OPEN_FLAGS.O_NOFOLLOW
export const O_NOATIME = OPEN_FLAGS.O_NOATIME
export const O_CLOEXEC = OPEN_FLAGS.O_CLOEXEC

/**
 * The one object behind both `require("constants")`' fs half and `fs.constants`. `fs.ts` imports this, so the
 * two spellings are the same values by construction rather than by copy.
 */
export const constants = {
  F_OK,
  R_OK,
  W_OK,
  X_OK,
  COPYFILE_EXCL,
  COPYFILE_FICLONE,
  COPYFILE_FICLONE_FORCE,
  S_IFMT,
  S_IFDIR,
  S_IFREG,
  S_IFLNK,
  S_IFBLK,
  S_IFCHR,
  S_IFIFO,
  S_IFSOCK,
  S_IRUSR,
  S_IWUSR,
  S_IXUSR,
  S_IRGRP,
  S_IWGRP,
  S_IXGRP,
  S_IROTH,
  S_IWOTH,
  S_IXOTH,
  ...OPEN_FLAGS,
} as const

/**
 * libuv's own spellings, which Node's flat `constants` module carries next to the short names (measured on
 * Node 26: both `UV_FS_COPYFILE_EXCL` and `COPYFILE_EXCL` are keys). Same values, so they are derived here
 * rather than written twice.
 */
export const UV_FS_COPYFILE_EXCL = COPYFILE_EXCL
export const UV_FS_COPYFILE_FICLONE = COPYFILE_FICLONE
export const UV_FS_COPYFILE_FICLONE_FORCE = COPYFILE_FICLONE_FORCE

export default constants
