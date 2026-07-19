# NeoView thumbnail system benchmark

This benchmark validates the complete backend thumbnail path rather than only SQLite `get`/`getMany` latency:

- `PlatformDirectoryListingProvider` enumeration;
- `CoreReaderDirectoryBrowser` open, sort, and pagination;
- `PlatformThumbnailPipeline` and `ThumbnailCoordinator`;
- real `sharp/libvips` JPEG decode, resize, and WebP encode;
- generation cancellation during rapid scrolling;
- bounded queued/running flights;
- encoded-byte L1 hits;
- RSS growth and dispose-to-zero lifecycle.

It never opens or writes `%APPDATA%\NeoView\thumbnails.db`.

The benchmark injects the production `ResourceSchedulerService` into both `PlatformThumbnailPipeline` and `SharpImageTransformer`. It therefore verifies the same global CPU-pool path used by the backend rather than the CLI/TUI fallback scheduler, and reports CPU/I/O/GPU pool state after disposal.

The separate `benchmark:neoview-thumbnails` command is the only benchmark in this document that opens the legacy database. It uses a query-only connection, reports aggregates only, and never prints a thumbnail key or Blob.

## Legacy database read baseline

```powershell
bun run benchmark:neoview-thumbnails -- `
  --database "$env:APPDATA\NeoView\thumbnails.db" `
  --iterations 1000 `
  --batch 512
```

On 2026-07-18 the current 2.4 main database was 835,448,832 bytes with 14,258 thumbnail rows. The streamed database SHA-256 was `2d53dc58e4a02d378af0d5da15f8c7eff952ace1feb7fb26495a5638fcaa6ede`; the database reported WAL mode with no WAL sidecar bytes and a 32 KiB SHM sidecar. Bun 1.4.0 on Windows x64 was used with 5,000 single reads and 50 batches of 512 records. Cache state is explicitly recorded as unspecified. All rows contained non-empty direct image Blobs; no sampled or aggregate row used the old `LZ4\0` wrapper. The benchmark does not retain paths or image bytes.

| Read shape | Result |
| --- | ---: |
| Single record average | 0.1248 ms |
| Raw 512-record batch average | 56.91 ms |
| Cooperative 512-record batch average | 60.11 ms |
| Cooperative overhead at 512 records | 5.6% |
| Host I/O leases after 50 cooperative batches | 400 granted / 400 released / 0 active / 0 queued |
| Exact maintenance statistics | 107.12 ms / 57 I/O leases released |

The production prewarm path therefore keeps the existing SQLite binding and `ReaderThumbnailStore`, but reads at most 64 records per synchronous chunk, acquires a host I/O lease for each chunk, and uses Node's built-in `scheduler.yield()` between chunks. This trades a small amount of total throughput for an approximately 4–5 ms average blocking window instead of one approximately 34 ms window. The current evidence does not justify adding a Worker/Piscina layer or a second SQLite implementation; revisit that decision only if compressed legacy Blobs or slower storage fail the retained performance budgets.

The old maintenance aggregate (`SUM(length(value))` plus category expressions in one full-table query) was measured separately at about 651 ms average and blocked the backend event loop for the whole query. The replacement opens an existing query-only SQLite connection, starts a read snapshot, obtains file/folder counts from the legacy category index, and walks `rowid + length(value)` in 256-row pages. On this database it returned the exact 816,513,264 Blob bytes and 16 failure rows (1 decode error, 15 unsupported-format) in 107.12 ms end to end; the underlying 56 scan chunks remain bounded by the existing cooperative reader. No old table, index, journal setting, `metadata.version`, or `user_version` is changed.

Cold and warm generation measure the same page. The pipeline evicts its encoded L1 entry between samples, so the warm result still performs archive/file access, decode, resize, and WebP encode while allowing operating-system and archive-source caches to remain warm.

## Synthetic structural smoke

```powershell
bun run benchmark:neoview-thumbnail-system -- `
  --work-root D:\temp `
  --storage-label synthetic-structural
```

The default synthetic fixture has 1,000 3840x2160 JPEG page entries and 10,000 browser entries. Page files are hard links to one deterministic high-detail JPEG, so this mode is reproducible and disk-efficient. It proves queue cancellation, lifecycle, and target-scale metadata behavior, but it is not a real corpus and therefore reports:

```json
{ "kind": "synthetic-smoke", "acceptanceEligible": false }
```

`--quick` reduces the fixture to 128 pages and 1,000 directory entries. Temporary files are deleted unless `--keep` is specified.

### 2026-07-16 structural baseline

The full synthetic command above was run on Windows x64 with Bun 1.4.0. This is retained as a regression baseline, not release acceptance:

| Metric | Result |
| --- | ---: |
| Fixture setup | 7,380.48 ms |
| 10,000-entry provider read | 21.92 ms |
| Browser open and sort | 23.06 ms |
| 1,000-page book open | 191.33 ms |
| Cold 4K JPEG generation | 72.06 ms |
| Warm 4K JPEG generation | 58.27 ms |
| Rapid-scroll dispatch | 16.41 ms |
| Demands | 1,024 |
| Superseded/cancelled | 992 |
| Final visible completed | 32/32 |
| Peak active / queued / running | 32 / 24 / 8 |
| Final visible ready P95 | 990.54 ms |
| L1 hit P95 | 0.02 ms |
| RSS delta | 81.10 MiB |
| Work after release | 0 demands / 0 flights |
| State after dispose | 0 demands / 0 flights / 0 cache bytes |

The synthetic pages are hard links to one deterministic JPEG and benefit from shared filesystem cache. These numbers must not be described as HDD/SATA SSD/NVMe results.

## Mixed real-page smoke

Supplying only one real source is useful for targeted diagnostics, but it is never release acceptance. The benchmark generates only the missing half and reports:

```json
{ "kind": "mixed-smoke", "acceptanceEligible": false }
```

On 2026-07-16, a 1,008,450,309-byte ZIP containing 2,259 AVIF image entries was used as the real page source on an NVMe Predator SSD GM7 M.2 2TB. The directory side was a generated 1,000-entry fixture. Cold and warm generation used the same first AVIF entry with the encoded L1 entry evicted between samples:

| Metric | Result |
| --- | ---: |
| 1,000-entry provider read | 6.25 ms |
| Browser open and sort | 4.21 ms |
| 2,259-page ZIP open | 65.62 ms |
| Cold AVIF generation | 118.97 ms |
| Warm AVIF generation after L1 eviction | 51.66 ms |
| Demands / cancelled / failed | 1,024 / 992 / 0 |
| Peak active / queued / running | 32 / 24 / 8 |
| Final visible completed | 32/32 |
| Final visible ready P95 | 2,311.13 ms |
| L1 hit P95 | 0.02 ms |
| RSS delta | 165.01 MiB |
| Work after release | 0 demands / 0 flights |
| State after dispose | 0 demands / 0 flights / 0 cache bytes |
| Host pools after dispose | CPU/I/O/GPU all 0 active / 0 queued |

This production-scheduler run passed generation, queue-lifecycle, and 256 MiB RSS-delta budgets. An immediately preceding run without the explicit benchmark scheduler report reached 278.07 MiB, so one passing sample is not sufficient to claim stable memory acceptance. Mixed smoke does not execute `--assert`; repeated real-corpus runs across the required storage classes remain mandatory.

## Real-corpus acceptance

```powershell
bun run benchmark:neoview-thumbnail-system -- `
  --page-source E:\benchmark\real-1000-page-book `
  --directory-source E:\benchmark\real-10000-entry-directory `
  --storage-label "NVMe Samsung 990 PRO" `
  --report E:\benchmark-reports\thumbnail-system-nvme-20260719.json `
  --pages 1000 `
  --files 10000 `
  --window 32 `
  --assert
```

`--page-source` may be a supported directory or archive. `--directory-source` may be a directory or a file inside the target directory. `--assert` refuses to run unless both sources are explicitly supplied, the requested counts are at least 1,000/10,000, and `--storage-label` is not `unspecified`.

Run the same corpus separately on HDD, SATA SSD, and NVMe. Do not combine their samples or label an OS-cache-warm run as cold storage. The JSON report intentionally records the supplied storage label but not corpus paths. `--report` writes the JSON through a same-directory staging file and atomic rename; it refuses an existing target before the benchmark starts, so retained acceptance evidence cannot be silently overwritten.

## Default budgets

| Metric | Default |
| --- | ---: |
| Directory provider read | <= 2,000 ms |
| Browser open and sort | <= 2,500 ms |
| Cold single-page generation | <= 250 ms |
| Warm single-page generation | <= 250 ms |
| Final visible-window ready P95 | <= 4,000 ms |
| Encoded L1 hit P95 | <= 15 ms |
| RSS delta | <= 256 MiB |
| Peak running flights | <= 8 |
| Peak active flights | <= visible window |
| Demands/flights after release | 0 |
| Demands/flights/cache after dispose | 0 |

Budgets can be overridden for controlled experiments with:

```text
NEOVIEW_THUMBNAIL_MAX_DIRECTORY_READ_MS
NEOVIEW_THUMBNAIL_MAX_BROWSER_OPEN_MS
NEOVIEW_THUMBNAIL_MAX_COLD_GENERATION_MS
NEOVIEW_THUMBNAIL_MAX_WARM_GENERATION_MS
NEOVIEW_THUMBNAIL_MAX_VISIBLE_READY_P95_MS
NEOVIEW_THUMBNAIL_MAX_L1_HIT_P95_MS
NEOVIEW_THUMBNAIL_MAX_RSS_DELTA_MIB
```

An override must be recorded with the result and does not silently replace the migration document's release target.

## Completion rule

Synthetic smoke results are regression evidence only. The `thumbnail-system` feature remains pending until real-corpus `--assert` runs pass on the required storage classes and the reports are retained with runtime, platform, corpus counts, storage label, queue peaks, latency summaries, cancellation totals, and memory lifecycle.
