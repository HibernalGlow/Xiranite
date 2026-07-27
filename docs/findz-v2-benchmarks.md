# Findz v2 benchmark evidence

This report covers the header-only and incremental paths required by the Findz v2 design. It does not claim that durable SQLite indexing is as cheap as a bare `zip.OpenReader` loop; the latter is included only as a central-directory reference.

## Reproduction

Run from `native/findz-go` on Windows:

```text
$env:GOMAXPROCS = "1"
go test -run '^$' -bench '^BenchmarkFindzZIPIndexing$' -benchmem -benchtime=1s -count=1
go test -run '^$' -bench '^BenchmarkFindzZIPIndexing/(metadata_sniff_read|metadata_header_parse)$' -benchmem -benchtime=1s -count=3
```

The benchmark creates 24 ZIP/CBZ archives with 32 valid PNG members each (768 members total). Each valid PNG has 128 KiB of trailing padding, so the metadata sub-benchmarks can distinguish a full bounded-prefix read from a header-only read without changing the image dimensions. It reports archive bytes per operation, actual decompressed member bytes read, Go allocation volume, skipped and budget-exceeded members, and configured analysis workers.

`findz_cold_index` includes durable SQLite writes. `findz_warm_unchanged` reuses the source fingerprint and does not reopen ZIP payloads. `metadata_prefix_read` reads every member up to the normal 512 KiB budget. `metadata_sniff_read` reads the same 64 B that the standard JPEG/PNG/GIF header path may request, without parsing. `metadata_header_parse` decodes the header over that same bounded stream. `TestFindzReadsPNGDimensionsWithoutConsumingThePrefixBudget` separately verifies that a padded valid PNG still yields dimensions and does not consume the 512 KiB budget.

## Captured run

Environment: Windows x64, AMD Ryzen 7 8845H with Radeon 780M Graphics.

```text
BenchmarkFindzZIPIndexing/central_directory_baseline    2.02 ms/op  24 archives/op  768 members/op   350,417 B/op   3,384 allocs/op
BenchmarkFindzZIPIndexing/findz_cold_index             41.03 ms/op  24 archives/op  768 members/op 1,380,520 B/op  19,930 allocs/op
BenchmarkFindzZIPIndexing/findz_warm_unchanged          5.08 ms/op  24 archives/op  768 members/op    55,683 B/op   1,440 allocs/op
BenchmarkFindzZIPIndexing/metadata_prefix_read         38.05 ms/op 768 members/op 100,745,472 metadata bytes read/op   590,104 B/op 10,297 allocs/op
BenchmarkFindzZIPIndexing/metadata_sniff_read          14.81 ms/op 768 members/op         49,152 metadata bytes read/op   577,808 B/op  9,529 allocs/op
BenchmarkFindzZIPIndexing/metadata_header_parse        16.92 ms/op 768 members/op         49,152 metadata bytes read/op 1,505,624 B/op 12,602 allocs/op
```

The full-prefix path decompresses approximately 100.7 MiB for the corpus. The standard header parser reads 49 KiB, or 64 B per member, while returning the same dimensions. The three repeated, single-worker matching 64 B runs were `16.04 ms -> 16.06 ms` (+0.1%), `16.51 ms -> 15.77 ms` (-4.5%), and `15.02 ms -> 17.84 ms` (+18.9%). All are within the 20% metadata-adapter gate. Every run reported zero skipped and zero budget-exceeded members.

The warm unchanged path performs no image analysis and is the relevant restart/incremental behavior: only filesystem fingerprints and indexed state are revisited. The cold-index reference is intentionally reported separately because it includes SQLite persistence that the bare central-directory loop does not perform; comparing those two absolute numbers would not measure image-analysis overhead. The allocation figures are Go allocations per operation, not a process peak-memory claim.
