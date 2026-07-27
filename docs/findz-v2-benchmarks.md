# Findz v2 benchmark evidence

This report covers the header-only and incremental paths required by the Findz v2 design. It does not claim that durable SQLite indexing is as cheap as a bare `zip.OpenReader` loop; the latter is included only as a central-directory reference.

## Reproduction

Run from `native/findz-go` on Windows:

```text
$env:GOMAXPROCS = "1"
go test -run '^$' -bench '^BenchmarkFindzZIPIndexing$' -benchmem -benchtime=1s -count=1
go test -run '^$' -bench '^BenchmarkFindzZIPIndexing/(metadata_prefix_read|metadata_header_parse)$' -benchmem -benchtime=1s -count=3
```

The benchmark creates 24 ZIP/CBZ archives with 32 PNG members each (768 members total), and reports archive bytes per operation. `findz_cold_index` includes durable SQLite writes. `findz_warm_unchanged` reuses the source fingerprint and does not reopen ZIP payloads. The two metadata sub-benchmarks read the bounded image prefix; one stops after the read and the other parses the header. They also report image-prefix bytes, skipped and budget-exceeded members, and configured analysis workers.

## Captured run

Environment: Windows x64, AMD Ryzen 7 8845H with Radeon 780M Graphics.

```text
BenchmarkFindzZIPIndexing/central_directory_baseline   3.71 ms/op  24 archives/op   768 members/op
BenchmarkFindzZIPIndexing/findz_cold_index             52.14 ms/op  24 archives/op   768 members/op
BenchmarkFindzZIPIndexing/findz_warm_unchanged           7.65 ms/op  24 archives/op   768 members/op
BenchmarkFindzZIPIndexing/metadata_prefix_read          25.88 ms/op  768 members/op  82,176 prefix bytes/op  1 worker
BenchmarkFindzZIPIndexing/metadata_header_parse         28.10 ms/op  768 members/op  82,176 prefix bytes/op  1 worker
```

The captured header parser adds approximately 8.6% over reading the same bounded prefix. The three repeated, single-worker metadata runs had paired overheads of 8.6%, -3.6%, and 10.2%; all remain below the 20% metadata-adapter gate. Each fixture member was fully smaller than its 512 KiB prefix budget, so the captured run correctly reports zero skipped and zero budget-exceeded members. The warm unchanged path performs no image analysis and is the relevant restart/incremental behavior: only filesystem fingerprints and indexed state are revisited. The cold-index reference is intentionally reported separately because it includes SQLite persistence that the bare central-directory loop does not perform; comparing those two absolute numbers would not measure image-analysis overhead.
