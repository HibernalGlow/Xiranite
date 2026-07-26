package main

import (
	"archive/zip"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/laktak/zfind/filter"
	"github.com/laktak/zfind/find"
)

const zipEncryptionFlag = 1

func (service *findzService) startScan(runtime *libraryRuntime) (taskRecord, error) {
	task, err := service.createTask(runtime, "scan", scanParams{LibraryID: runtime.id})
	if err != nil {
		return task, err
	}
	controller := service.installTaskController(task.ID)
	go service.runFullScan(runtime, task.ID, controller)
	return task, nil
}

func (service *findzService) runFullScan(runtime *libraryRuntime, taskID string, controller *taskController) {
	if err := updateTask(runtime, taskID, "running", "Discovering ZIP and CBZ archives."); err != nil {
		return
	}
	paths, discoveryErrors := discoverArchivesWithZfind(runtime.root)
	_ = setTaskTotals(runtime, taskID, int64(len(paths)), 0)

	scanToken := newTaskID()
	var done int64
	warnings := len(discoveryErrors)
	for _, path := range paths {
		if !controller.waitUntilRunnable() {
			return
		}
		if err := indexArchive(runtime, path, scanToken); err != nil {
			warnings++
		}
		done++
		_ = updateTaskCounters(runtime, taskID, done, 0, 0, int64(warnings))
	}
	if controller.waitUntilRunnable() {
		if _, err := runtime.db.Exec(`DELETE FROM archive WHERE last_seen_scan <> ?`, scanToken); err != nil {
			warnings++
		}
	}
	finishScanTask(runtime, taskID, warnings)
}

func finishScanTask(runtime *libraryRuntime, taskID string, warnings int) {
	status := "completed"
	message := "ZIP index is current."
	if warnings > 0 {
		status = "completed_with_warnings"
		message = fmt.Sprintf("ZIP index completed with %d warning(s).", warnings)
	}
	_ = updateTask(runtime, taskID, status, message)
}

func discoverArchivesWithZfind(root string) ([]string, []error) {
	matcher, err := filter.CreateFilter(`type = "file"`)
	if err != nil {
		return nil, []error{fmt.Errorf("create zfind discovery filter: %w", err)}
	}
	results := make(chan find.FileInfo)
	errors := make(chan string)
	go func() {
		// zfind owns recursive discovery. NoArchive prevents its archive walker from
		// opening every member; Findz indexes ZIP central directories separately.
		find.Walk(root, find.WalkParams{Chan: results, Err: errors, Filter: matcher, NoArchive: true})
		close(results)
		close(errors)
	}()

	paths := make([]string, 0)
	discoveryErrors := make([]error, 0)
	for results != nil || errors != nil {
		select {
		case file, open := <-results:
			if !open {
				results = nil
				continue
			}
			if isFindzArchivePath(file.Path) {
				paths = append(paths, file.Path)
			}
		case message, open := <-errors:
			if !open {
				errors = nil
				continue
			}
			discoveryErrors = append(discoveryErrors, fmt.Errorf("zfind discovery: %s", message))
		}
	}
	sort.Strings(paths)
	return paths, discoveryErrors
}

func (service *findzService) applyWatcherChanges(runtime *libraryRuntime, changes []watcherChange) (taskRecord, error) {
	task, err := service.createTask(runtime, "watcher", watcherApplyParams{LibraryID: runtime.id, Changes: changes})
	if err != nil {
		return task, err
	}
	controller := service.installTaskController(task.ID)
	go service.runWatcherChanges(runtime, task.ID, changes, controller)
	return task, nil
}

func (service *findzService) runWatcherChanges(runtime *libraryRuntime, taskID string, changes []watcherChange, controller *taskController) {
	if err := updateTask(runtime, taskID, "running", "Applying filesystem changes."); err != nil {
		return
	}
	byPath := make(map[string]watcherChange)
	for _, change := range changes {
		absolute, err := filepath.Abs(change.Path)
		if err != nil || !pathWithinRoot(runtime.root, absolute) || !isFindzArchivePath(absolute) {
			continue
		}
		byPath[absolute] = change
	}
	paths := make([]string, 0, len(byPath))
	for path := range byPath {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	_ = setTaskTotals(runtime, taskID, int64(len(paths)), 0)

	var done int64
	warnings := 0
	for _, path := range paths {
		if !controller.waitUntilRunnable() {
			return
		}
		change := byPath[path]
		if change.Type == "delete" || !pathExists(path) {
			if err := deleteArchiveByPath(runtime, path); err != nil {
				warnings++
			}
		} else if err := indexArchive(runtime, path, newTaskID()); err != nil {
			warnings++
		}
		done++
		_ = updateTaskCounters(runtime, taskID, done, 0, 0, int64(warnings))
	}
	finishScanTask(runtime, taskID, warnings)
}

func (service *findzService) resumeStoredScan(runtime *libraryRuntime, task taskRecord) error {
	var params watcherApplyParams
	if task.Kind == "watcher" {
		if err := readTaskParams(runtime, task.ID, &params); err != nil {
			return err
		}
		controller := service.installTaskController(task.ID)
		if err := updateTask(runtime, task.ID, "running", "Resumed watcher update."); err != nil {
			return err
		}
		go service.runWatcherChanges(runtime, task.ID, params.Changes, controller)
		return nil
	}
	controller := service.installTaskController(task.ID)
	if err := updateTask(runtime, task.ID, "running", "Resumed scan."); err != nil {
		return err
	}
	go service.runFullScan(runtime, task.ID, controller)
	return nil
}

func readTaskParams(runtime *libraryRuntime, taskID string, target interface{}) error {
	var raw string
	if err := runtime.db.QueryRow(`SELECT params_json FROM task WHERE id = ?`, taskID).Scan(&raw); err != nil {
		return fmt.Errorf("read Findz task params: %w", err)
	}
	if err := json.Unmarshal([]byte(raw), target); err != nil {
		return fmt.Errorf("decode Findz task params: %w", err)
	}
	return nil
}

func indexArchive(runtime *libraryRuntime, fullPath string, scanToken string) error {
	info, err := os.Stat(fullPath)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("archive is not a regular file: %s", fullPath)
	}
	relativePath, err := filepath.Rel(runtime.root, fullPath)
	if err != nil || relativePath == "." || strings.HasPrefix(relativePath, "..") {
		return fmt.Errorf("archive is outside library root: %s", fullPath)
	}
	relativePath = filepath.ToSlash(relativePath)
	fingerprint := sourceFingerprint(fullPath, info)

	var existingID int64
	var existingFingerprint string
	err = runtime.db.QueryRow(`SELECT id, source_identity FROM archive WHERE relative_path = ?`, relativePath).Scan(&existingID, &existingFingerprint)
	if err == nil && existingFingerprint == fingerprint {
		_, err = runtime.db.Exec(`UPDATE archive SET last_seen_scan = ?, updated_at = ? WHERE id = ?`, scanToken, time.Now().UTC().Format(time.RFC3339Nano), existingID)
		return err
	}
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("read indexed archive fingerprint: %w", err)
	}

	tx, err := runtime.db.Begin()
	if err != nil {
		return fmt.Errorf("begin archive transaction: %w", err)
	}
	defer tx.Rollback()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	archiveID, err := upsertArchive(tx, relativePath, fingerprint, info, scanToken, now)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM archive_member WHERE archive_id = ?`, archiveID); err != nil {
		return fmt.Errorf("clear changed archive members: %w", err)
	}

	reader, err := zip.OpenReader(fullPath)
	if err != nil {
		if _, updateErr := tx.Exec(`UPDATE archive SET scan_state = 'corrupt_archive', error_code = ?, updated_at = ? WHERE id = ?`, "corrupt_archive", now, archiveID); updateErr != nil {
			return fmt.Errorf("record corrupt archive: %w", updateErr)
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return fmt.Errorf("commit corrupt archive: %w", commitErr)
		}
		return fmt.Errorf("open ZIP central directory: %w", err)
	}
	defer reader.Close()

	statement, err := tx.Prepare(`INSERT INTO archive_member (
		archive_id, entry_index, member_path, crc32, compressed_size, uncompressed_size, compression_method, modified_at, extension,
		is_directory, is_image_candidate, is_nested_archive, is_encrypted
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare member insert: %w", err)
	}
	defer statement.Close()
	for entryIndex, member := range reader.File {
		if err := insertArchiveMember(statement, archiveID, entryIndex, member); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE archive SET scan_state = 'indexed', error_code = '', updated_at = ? WHERE id = ?`, now, archiveID); err != nil {
		return fmt.Errorf("mark indexed archive: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit archive index: %w", err)
	}
	return nil
}

func upsertArchive(tx *sql.Tx, relativePath string, fingerprint string, info os.FileInfo, scanToken string, now string) (int64, error) {
	if _, err := tx.Exec(`INSERT INTO archive (relative_path, source_identity, size, mtime_ns, scan_state, last_seen_scan, created_at, updated_at)
		VALUES (?, ?, ?, ?, 'indexing', ?, ?, ?)
		ON CONFLICT(relative_path) DO UPDATE SET source_identity = excluded.source_identity, size = excluded.size,
		mtime_ns = excluded.mtime_ns, scan_state = 'indexing', error_code = '', last_seen_scan = excluded.last_seen_scan,
		updated_at = excluded.updated_at`, relativePath, fingerprint, info.Size(), info.ModTime().UnixNano(), scanToken, now, now); err != nil {
		return 0, fmt.Errorf("upsert archive: %w", err)
	}
	var archiveID int64
	if err := tx.QueryRow(`SELECT id FROM archive WHERE relative_path = ?`, relativePath).Scan(&archiveID); err != nil {
		return 0, fmt.Errorf("resolve archive id: %w", err)
	}
	return archiveID, nil
}

func insertArchiveMember(statement *sql.Stmt, archiveID int64, entryIndex int, member *zip.File) error {
	if member.CompressedSize64 > math.MaxInt64 || member.UncompressedSize64 > math.MaxInt64 {
		return fmt.Errorf("ZIP member exceeds SQLite integer range: %s", member.Name)
	}
	isDirectory := member.FileInfo().IsDir() || strings.HasSuffix(member.Name, "/")
	extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(member.Name)), ".")
	_, err := statement.Exec(
		archiveID, entryIndex, strings.TrimSuffix(filepath.ToSlash(member.Name), "/"), uint64(member.CRC32), int64(member.CompressedSize64), int64(member.UncompressedSize64),
		member.Method, member.Modified.UTC().Format(time.RFC3339Nano), extension, boolToInt(isDirectory), boolToInt(!isDirectory && isImageExtension(extension)),
		boolToInt(!isDirectory && isFindzArchivePath(member.Name)), boolToInt(member.Flags&zipEncryptionFlag != 0),
	)
	if err != nil {
		return fmt.Errorf("insert ZIP member %s: %w", member.Name, err)
	}
	return nil
}

func deleteArchiveByPath(runtime *libraryRuntime, fullPath string) error {
	relativePath, err := filepath.Rel(runtime.root, fullPath)
	if err != nil || strings.HasPrefix(relativePath, "..") {
		return fmt.Errorf("archive is outside library root: %s", fullPath)
	}
	_, err = runtime.db.Exec(`DELETE FROM archive WHERE relative_path = ?`, filepath.ToSlash(relativePath))
	return err
}

func isFindzArchivePath(path string) bool {
	extension := strings.ToLower(filepath.Ext(path))
	return extension == ".zip" || extension == ".cbz"
}

func isImageExtension(extension string) bool {
	switch strings.ToLower(extension) {
	case "jpg", "jpeg", "png", "gif", "webp", "avif", "heif", "heic", "jxl":
		return true
	default:
		return false
	}
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func pathWithinRoot(root string, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func sourceFingerprint(path string, info os.FileInfo) string {
	return fmt.Sprintf("%s:%d:%d", fileIdentity(path), info.Size(), info.ModTime().UnixNano())
}
