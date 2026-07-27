package main

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func BenchmarkFindzZIPIndexing(b *testing.B) {
	root := b.TempDir()
	paths, totalBytes, memberCount, imagePayloadBytes := createBenchmarkCorpus(b, root, 24, 32)
	b.Run("central_directory_baseline", func(b *testing.B) {
		b.ReportAllocs()
		b.SetBytes(totalBytes)
		b.ReportMetric(float64(len(paths)), "archives/op")
		b.ReportMetric(float64(memberCount), "members/op")
		for index := 0; index < b.N; index++ {
			for _, path := range paths {
				reader, err := zip.OpenReader(path)
				if err != nil {
					b.Fatal(err)
				}
				_ = len(reader.File)
				if err := reader.Close(); err != nil {
					b.Fatal(err)
				}
			}
		}
	})
	b.Run("findz_cold_index", func(b *testing.B) {
		b.ReportAllocs()
		b.SetBytes(totalBytes)
		b.ReportMetric(float64(len(paths)), "archives/op")
		b.ReportMetric(float64(memberCount), "members/op")
		for index := 0; index < b.N; index++ {
			runtime, err := openLibraryDatabase(libraryOpenParams{LibraryID: fmt.Sprintf("cold-%d", index), Root: root, DatabasePath: filepath.Join(b.TempDir(), "index.sqlite")})
			if err != nil {
				b.Fatal(err)
			}
			for _, path := range paths {
				if err := indexArchive(runtime, path, fmt.Sprintf("scan-%d", index)); err != nil {
					b.Fatal(err)
				}
			}
			if err := runtime.db.Close(); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("findz_warm_unchanged", func(b *testing.B) {
		runtime, err := openLibraryDatabase(libraryOpenParams{LibraryID: "warm", Root: root, DatabasePath: filepath.Join(b.TempDir(), "index.sqlite")})
		if err != nil {
			b.Fatal(err)
		}
		defer runtime.db.Close()
		for _, path := range paths {
			if err := indexArchive(runtime, path, "initial"); err != nil {
				b.Fatal(err)
			}
		}
		b.ReportAllocs()
		b.SetBytes(totalBytes)
		b.ReportMetric(float64(len(paths)), "archives/op")
		b.ReportMetric(float64(memberCount), "members/op")
		b.ResetTimer()
		for index := 0; index < b.N; index++ {
			for _, path := range paths {
				if err := indexArchive(runtime, path, fmt.Sprintf("warm-%d", index)); err != nil {
					b.Fatal(err)
				}
			}
		}
	})
	b.Run("metadata_prefix_read", func(b *testing.B) {
		b.ReportAllocs()
		b.SetBytes(totalBytes)
		reportImageAnalysisMetrics(b, memberCount, imagePayloadBytes)
		for index := 0; index < b.N; index++ {
			for _, path := range paths {
				reader, err := zip.OpenReader(path)
				if err != nil {
					b.Fatal(err)
				}
				for _, member := range reader.File {
					if !isImageExtension(filepath.Ext(member.Name)[1:]) {
						continue
					}
					stream, err := member.Open()
					if err != nil {
						b.Fatal(err)
					}
					if _, err := io.Copy(io.Discard, io.LimitReader(stream, standardImagePrefixBudget)); err != nil {
						b.Fatal(err)
					}
					if err := stream.Close(); err != nil {
						b.Fatal(err)
					}
				}
				if err := reader.Close(); err != nil {
					b.Fatal(err)
				}
			}
		}
	})
	b.Run("metadata_header_parse", func(b *testing.B) {
		b.ReportAllocs()
		b.SetBytes(totalBytes)
		reportImageAnalysisMetrics(b, memberCount, imagePayloadBytes)
		for index := 0; index < b.N; index++ {
			for _, path := range paths {
				reader, err := zip.OpenReader(path)
				if err != nil {
					b.Fatal(err)
				}
				for _, member := range reader.File {
					if !isImageExtension(filepath.Ext(member.Name)[1:]) {
						continue
					}
					result := analyzeZipMember(member, "png", int64(member.CompressedSize64))
					if result.status != "complete" {
						b.Fatalf("benchmark image metadata failed: %#v", result)
					}
				}
				if err := reader.Close(); err != nil {
					b.Fatal(err)
				}
			}
		}
	})
}

func reportImageAnalysisMetrics(b *testing.B, memberCount int, imagePayloadBytes int64) {
	b.ReportMetric(float64(memberCount), "members/op")
	b.ReportMetric(float64(imagePayloadBytes), "prefix_bytes/op")
	b.ReportMetric(0, "skipped_members/op")
	b.ReportMetric(0, "budget_exceeded_members/op")
	b.ReportMetric(1, "analysis_workers")
}

func createBenchmarkCorpus(b *testing.B, root string, archiveCount int, membersPerArchive int) ([]string, int64, int, int64) {
	b.Helper()
	paths := make([]string, 0, archiveCount)
	imageContents := pngFixture(b, 32, 32)
	for archiveIndex := 0; archiveIndex < archiveCount; archiveIndex++ {
		path := filepath.Join(root, fmt.Sprintf("series-%02d.cbz", archiveIndex))
		file, err := os.Create(path)
		if err != nil {
			b.Fatal(err)
		}
		writer := zip.NewWriter(file)
		for memberIndex := 0; memberIndex < membersPerArchive; memberIndex++ {
			member, err := writer.Create(fmt.Sprintf("pages/%03d.png", memberIndex))
			if err != nil {
				b.Fatal(err)
			}
			if _, err := member.Write(imageContents); err != nil {
				b.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			b.Fatal(err)
		}
		if err := file.Close(); err != nil {
			b.Fatal(err)
		}
		paths = append(paths, path)
	}
	var totalBytes int64
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			b.Fatal(err)
		}
		totalBytes += info.Size()
	}
	memberCount := archiveCount * membersPerArchive
	return paths, totalBytes, memberCount, int64(memberCount * len(imageContents))
}
