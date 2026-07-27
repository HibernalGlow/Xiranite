package main

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFindzReadsCommonImageHeaderAdapters(t *testing.T) {
	imageValue := image.NewRGBA(image.Rect(0, 0, 13, 17))
	imageValue.Set(0, 0, color.RGBA{R: 64, G: 128, B: 255, A: 255})
	var jpegBytes bytes.Buffer
	if err := jpeg.Encode(&jpegBytes, imageValue, nil); err != nil {
		t.Fatal(err)
	}
	var gifBytes bytes.Buffer
	if err := gif.Encode(&gifBytes, imageValue, nil); err != nil {
		t.Fatal(err)
	}
	for _, testCase := range []struct {
		format string
		prefix []byte
	}{
		{format: "png", prefix: pngFixture(t, 13, 17)},
		{format: "jpeg", prefix: jpegBytes.Bytes()},
		{format: "gif", prefix: gifBytes.Bytes()},
	} {
		t.Run(testCase.format, func(t *testing.T) {
			width, height, err := decodeImageDimensions(testCase.format, testCase.prefix)
			if err != nil {
				t.Fatal(err)
			}
			if width != 13 || height != 17 {
				t.Fatalf("expected 13x17 dimensions, got %dx%d", width, height)
			}
		})
	}
}

func TestFindzIndexesNestedAndEncryptedMembers(t *testing.T) {
	root := t.TempDir()
	archivePath := filepath.Join(root, "marked.cbz")
	createZipFixture(t, archivePath, []zipFixture{
		{name: "locked.png", contents: pngFixture(t, 8, 8)},
		{name: "nested/child.zip", contents: []byte("nested archive")},
	})
	markZipMemberEncrypted(t, archivePath, "locked.png")

	service, runtime := openTestLibrary(t, root)
	task, err := service.startScan(runtime)
	if err != nil {
		t.Fatal(err)
	}
	waitForTask(t, runtime, task.ID)
	archives, err := queryArchives(runtime, archiveQueryParams{LibraryID: runtime.id, Page: pageRequest{Limit: 10}})
	if err != nil {
		t.Fatal(err)
	}
	members, err := queryMembers(runtime, memberQueryParams{LibraryID: runtime.id, ArchiveID: archives.Items[0].ID, Page: pageRequest{Limit: 10}})
	if err != nil {
		t.Fatal(err)
	}
	if len(members.Items) != 2 {
		t.Fatalf("expected two members, got %#v", members.Items)
	}
	if !members.Items[0].Encrypted || !members.Items[1].NestedArchive {
		t.Fatalf("expected encrypted and nested markers, got %#v", members.Items)
	}
}

func TestFindzValidatesZIPSafetyLimitsBeforeWritingMembers(t *testing.T) {
	limits := zipSafetyLimits{maxEntries: 1, maxMemberPathBytes: 16}
	if err := limits.validate([]*zip.File{{FileHeader: zip.FileHeader{Name: "first.png"}}, {FileHeader: zip.FileHeader{Name: "second.png"}}}); err == nil {
		t.Fatal("expected entry-count safety failure")
	} else if failure, ok := err.(*zipScanFailure); !ok || failure.code != "member_count_limit_exceeded" {
		t.Fatalf("expected entry-count failure, got %#v", err)
	}
	if err := limits.validate([]*zip.File{{FileHeader: zip.FileHeader{Name: "this/member/path/is/too/long.png"}}}); err == nil {
		t.Fatal("expected member-path safety failure")
	} else if failure, ok := err.(*zipScanFailure); !ok || failure.code != "member_path_length_exceeded" {
		t.Fatalf("expected member-path failure, got %#v", err)
	}
	if err := limits.validate([]*zip.File{{FileHeader: zip.FileHeader{Name: "../escape.png"}}}); err == nil {
		t.Fatal("expected unsafe member-path failure")
	} else if failure, ok := err.(*zipScanFailure); !ok || failure.code != "unsafe_member_path" {
		t.Fatalf("expected unsafe path failure, got %#v", err)
	}
}

func TestFindzWatcherReindexesChangedArchivesAndDeletesRemovedPaths(t *testing.T) {
	root := t.TempDir()
	archivePath := filepath.Join(root, "volume.cbz")
	createZipFixture(t, archivePath, []zipFixture{{name: "before.txt", contents: []byte("before")}})
	service, runtime := openTestLibrary(t, root)
	initial, err := service.startScan(runtime)
	if err != nil {
		t.Fatal(err)
	}
	waitForTask(t, runtime, initial.ID)

	createZipFixture(t, archivePath, []zipFixture{{name: "after.txt", contents: []byte("after")}})
	changedAt := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(archivePath, changedAt, changedAt); err != nil {
		t.Fatal(err)
	}
	update, err := service.applyWatcherChanges(runtime, []watcherChange{{Path: archivePath, Type: "update"}})
	if err != nil {
		t.Fatal(err)
	}
	waitForTask(t, runtime, update.ID)
	archives, err := queryArchives(runtime, archiveQueryParams{LibraryID: runtime.id, Page: pageRequest{Limit: 10}})
	if err != nil {
		t.Fatal(err)
	}
	members, err := queryMembers(runtime, memberQueryParams{LibraryID: runtime.id, ArchiveID: archives.Items[0].ID, Page: pageRequest{Limit: 10}})
	if err != nil {
		t.Fatal(err)
	}
	if len(members.Items) != 1 || members.Items[0].MemberPath != "after.txt" {
		t.Fatalf("changed archive retained stale members: %#v", members.Items)
	}

	if err := os.Remove(archivePath); err != nil {
		t.Fatal(err)
	}
	deleted, err := service.applyWatcherChanges(runtime, []watcherChange{{Path: archivePath, Type: "delete"}})
	if err != nil {
		t.Fatal(err)
	}
	waitForTask(t, runtime, deleted.ID)
	archives, err = queryArchives(runtime, archiveQueryParams{LibraryID: runtime.id, Page: pageRequest{Limit: 10}})
	if err != nil {
		t.Fatal(err)
	}
	if archives.Total != 0 {
		t.Fatalf("deleted archive remained indexed: %#v", archives)
	}
}

func TestFindzQueuesAndCoalescesWatcherChangesBehindAnActiveScan(t *testing.T) {
	root := t.TempDir()
	service, runtime := openTestLibrary(t, root)
	runtime.scanQueue.mu.Lock()
	runtime.scanQueue.active = true
	runtime.scanQueue.mu.Unlock()

	first, err := service.applyWatcherChanges(runtime, []watcherChange{{Path: filepath.Join(root, "first.cbz"), Type: "create"}})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.applyWatcherChanges(runtime, []watcherChange{
		{Path: filepath.Join(root, "first.cbz"), Type: "update"},
		{Path: filepath.Join(root, "second.cbz"), Type: "delete"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected watcher events to share a queued task, got %s and %s", first.ID, second.ID)
	}
	var params watcherApplyParams
	if err := readTaskParams(runtime, first.ID, &params); err != nil {
		t.Fatal(err)
	}
	if len(params.Changes) != 2 || params.Changes[0].Type != "update" || params.Changes[1].Type != "delete" {
		t.Fatalf("expected coalesced watcher changes, got %#v", params.Changes)
	}
}

func TestFindzRecoversRunningTasksAndRecordsSchemaMigration(t *testing.T) {
	root := t.TempDir()
	databasePath := filepath.Join(t.TempDir(), "findz.sqlite")
	runtime, err := openLibraryDatabase(libraryOpenParams{LibraryID: "recovery", Root: root, DatabasePath: databasePath})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.db.Exec(`INSERT INTO task (id, kind, status, params_json, message) VALUES ('running-task', 'scan', 'running', '{}', '')`); err != nil {
		t.Fatal(err)
	}
	if err := runtime.db.Close(); err != nil {
		t.Fatal(err)
	}

	recovered, err := openLibraryDatabase(libraryOpenParams{LibraryID: "recovery", Root: root, DatabasePath: databasePath})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = recovered.db.Close() })
	task, err := readTask(recovered, "running-task")
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != "paused" {
		t.Fatalf("expected recovered task to be paused, got %#v", task)
	}
	var migrationCount int
	if err := recovered.db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = 1`).Scan(&migrationCount); err != nil {
		t.Fatal(err)
	}
	if migrationCount != 1 {
		t.Fatalf("expected exactly one applied schema migration, got %d", migrationCount)
	}
}

func TestFindzFlagsStatisticalImageOutliers(t *testing.T) {
	root := t.TempDir()
	fixtures := make([]zipFixture, 0, 5)
	for index := 0; index < 5; index++ {
		fixtures = append(fixtures, zipFixture{name: "page-" + string(rune('a'+index)) + ".png", contents: pngFixture(t, 8, 8)})
	}
	createZipFixture(t, filepath.Join(root, "pages.cbz"), fixtures)
	service, runtime := openTestLibrary(t, root)
	scan, err := service.startScan(runtime)
	if err != nil {
		t.Fatal(err)
	}
	waitForTask(t, runtime, scan.ID)
	archives, err := queryArchives(runtime, archiveQueryParams{LibraryID: runtime.id, Page: pageRequest{Limit: 10}})
	if err != nil {
		t.Fatal(err)
	}
	members, err := queryMembers(runtime, memberQueryParams{LibraryID: runtime.id, ArchiveID: archives.Items[0].ID, Page: pageRequest{Limit: 10}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.db.Exec(`INSERT INTO analysis_run (id, policy_revision, started_at, status) VALUES ('outlier-run', ?, ?, 'completed')`, defaultAnalysisPolicy, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	values := []float64{100, 105, 95, 110, 900}
	for index, member := range members.Items {
		if _, err := runtime.db.Exec(`UPDATE archive_member SET compressed_size = ? WHERE id = ?`, int64(values[index]), member.ID); err != nil {
			t.Fatal(err)
		}
		if err := storeImageMetadata(runtime, "outlier-run", member.ID, imageMetadataResult{actualFormat: "png", width: 1_000, height: 1_000, pixels: 1_000_000, bytesPerMegapixel: values[index], status: "complete"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := recomputeAnomalies(runtime); err != nil {
		t.Fatal(err)
	}
	var anomalyCount int
	if err := runtime.db.QueryRow(`SELECT COUNT(*) FROM anomaly WHERE member_id = ? AND kind = 'bytes_per_megapixel_high'`, members.Items[4].ID).Scan(&anomalyCount); err != nil {
		t.Fatal(err)
	}
	if anomalyCount != 1 {
		t.Fatalf("expected only the high-density member to be anomalous, got %d", anomalyCount)
	}
}

func TestFindzProtocolErrorsUseStructuredEnvelopes(t *testing.T) {
	service := newFindzService()
	for _, testCase := range []struct {
		name string
		raw  string
		code string
	}{
		{name: "invalid json", raw: "{", code: "invalid_request"},
		{name: "unsupported version", raw: `{"requestVersion": 99, "requestId": "version", "method": "api.info"}`, code: "unsupported_request_version"},
		{name: "missing method", raw: `{"requestVersion": 1, "requestId": "method"}`, code: "invalid_request"},
		{name: "unsupported method", raw: `{"requestVersion": 1, "requestId": "unsupported", "method": "nope"}`, code: "unsupported_method"},
		{name: "invalid params", raw: `{"requestVersion": 1, "requestId": "params", "method": "library.open", "params": "not-an-object"}`, code: "invalid_params"},
		{name: "closed library", raw: `{"requestVersion": 1, "requestId": "library", "method": "query.archives", "params": {"libraryId": "missing"}}`, code: "library_not_open"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			response := service.handle([]byte(testCase.raw))
			if response.OK || response.Error == nil || response.Error.Code != testCase.code {
				t.Fatalf("expected %s envelope, got %#v", testCase.code, response)
			}
		})
	}
}

func markZipMemberEncrypted(t *testing.T, path string, memberName string) {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	updated := 0
	for offset := 0; offset <= len(contents)-30; offset++ {
		signature := binary.LittleEndian.Uint32(contents[offset:])
		flagsOffset, nameOffset, nameLengthOffset := 0, 0, 0
		switch signature {
		case 0x04034b50:
			flagsOffset, nameLengthOffset, nameOffset = offset+6, offset+26, offset+30
		case 0x02014b50:
			if offset > len(contents)-46 {
				continue
			}
			flagsOffset, nameLengthOffset, nameOffset = offset+8, offset+28, offset+46
		default:
			continue
		}
		nameLength := int(binary.LittleEndian.Uint16(contents[nameLengthOffset:]))
		if nameOffset+nameLength > len(contents) || string(contents[nameOffset:nameOffset+nameLength]) != memberName {
			continue
		}
		flags := binary.LittleEndian.Uint16(contents[flagsOffset:]) | zipEncryptionFlag
		binary.LittleEndian.PutUint16(contents[flagsOffset:], flags)
		updated++
	}
	if updated != 2 {
		t.Fatalf("expected local and central ZIP encryption flags for %s, updated %d headers", memberName, updated)
	}
	if err := os.WriteFile(path, contents, 0o644); err != nil {
		t.Fatal(err)
	}
}
