package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

// These tests pin the sidecar transport (ADR-0077): the frames that cross the pipe are the
// same envelope the C ABI used, so a regression here is a protocol change, not a refactor.

func decodeFrames(t *testing.T, raw string) []responseEnvelope {
	t.Helper()
	var frames []responseEnvelope
	scanner := bufio.NewScanner(strings.NewReader(raw))
	scanner.Buffer(make([]byte, 1<<20), 1<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var response responseEnvelope
		if err := json.Unmarshal(line, &response); err != nil {
			t.Fatalf("response frame is not valid JSON: %v (line: %s)", err, string(line))
		}
		frames = append(frames, response)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scanning responses failed: %v", err)
	}
	return frames
}

func requestFrame(id string, method string, params string) string {
	return fmt.Sprintf(`{"requestVersion":%d,"requestId":%q,"method":%q,"params":%s}`+"\n",
		findzRequestVersion, id, method, params)
}

func TestServeLoopAnswersTwoFramesInOrder(t *testing.T) {
	root := t.TempDir()
	database := filepath.Join(root, "index.sqlite")

	var input strings.Builder
	input.WriteString(requestFrame("s-open", "library.open",
		fmt.Sprintf(`{"root":%q,"databasePath":%q}`, root, database)))
	input.WriteString(requestFrame("s-info", "query.archives", `{"page":{"limit":10}}`))

	var output bytes.Buffer
	if err := serveLoop(strings.NewReader(input.String()), &output); err != nil {
		t.Fatalf("serveLoop: %v", err)
	}

	frames := decodeFrames(t, output.String())
	if len(frames) != 2 {
		t.Fatalf("expected two response frames, got %d: %q", len(frames), output.String())
	}
	if frames[0].RequestID != "s-open" || !frames[0].OK {
		t.Fatalf("first frame must answer the open request: %+v", frames[0])
	}
	if frames[1].RequestID != "s-info" {
		t.Fatalf("second frame must answer the second request, got %q", frames[1].RequestID)
	}
	// The second request omits libraryId on purpose: it must fail as data, and the loop must
	// still have produced a frame for it rather than dying on the first refusal.
	if frames[1].OK || frames[1].Error == nil {
		t.Fatalf("a query against an unopened library must be a refusal with a code: %+v", frames[1])
	}
}

func TestServeLoopRefusesOversizedFrameAndStaysInSync(t *testing.T) {
	root := t.TempDir()
	database := filepath.Join(root, "index.sqlite")

	// One byte past the cap, then a good frame. Without the drain the second request would be
	// answered with a fragment of the first, and this test would go red.
	oversized := `{"requestVersion":1,"requestId":"too-big","method":"library.open","params":{"blob":"` +
		strings.Repeat("x", maximumServeFrameBytes+1) + `"}}`

	var input strings.Builder
	input.WriteString(oversized + "\n")
	input.WriteString(requestFrame("after-big", "library.open",
		fmt.Sprintf(`{"root":%q,"databasePath":%q}`, root, database)))

	var output bytes.Buffer
	if err := serveLoop(strings.NewReader(input.String()), &output); err != nil {
		t.Fatalf("serveLoop: %v", err)
	}

	frames := decodeFrames(t, output.String())
	if len(frames) != 2 {
		t.Fatalf("oversized frame must be refused and the next request still answered, got %d frames: %q",
			len(frames), output.String())
	}
	if frames[0].OK || frames[0].Error == nil || frames[0].Error.Code != "request_too_large" {
		t.Fatalf("first frame must be the refusal request_too_large: %+v", frames[0])
	}
	if frames[1].RequestID != "after-big" || !frames[1].OK {
		t.Fatalf("second frame must survive the refused line: %+v", frames[1])
	}
}

func TestServeLoopRefusesFrameLongerThanTheCapAndKeepsNextFrame(t *testing.T) {
	root := t.TempDir()
	database := filepath.Join(root, "second.sqlite")

	// 这一条走的是「触发上限时行还没读完」的排空分支：4 MiB 的一行远远超过 1 MiB 的帽，
	// 所以 ReadSlice 一定是在 ErrBufferFull 上先撞上帽子的。上一条测覆盖的是另一分支
	// （结尾换行已经在手里时不许再排空）。两条合起来才算这把尺两头都看得见。
	huge := `{"requestVersion":1,"requestId":"huge","method":"library.open","params":{"blob":"` +
		strings.Repeat("y", 4*maximumServeFrameBytes) + `"}}`

	var input strings.Builder
	input.WriteString(huge + "\n")
	input.WriteString(requestFrame("after-huge", "library.open",
		fmt.Sprintf(`{"root":%q,"databasePath":%q}`, root, database)))

	var output bytes.Buffer
	if err := serveLoop(strings.NewReader(input.String()), &output); err != nil {
		t.Fatalf("serveLoop: %v", err)
	}
	frames := decodeFrames(t, output.String())
	if len(frames) != 2 {
		t.Fatalf("oversized frame must be refused and the next request still answered, got %d: %q",
			len(frames), firstChars(output.String(), 400))
	}
	if frames[0].Error == nil || frames[0].Error.Code != "request_too_large" {
		t.Fatalf("first frame must be the refusal: %+v", frames[0])
	}
	if frames[1].RequestID != "after-huge" || !frames[1].OK {
		t.Fatalf("second frame must survive a 4 MiB line: %+v", frames[1])
	}
}

func firstChars(text string, count int) string {
	if len(text) <= count {
		return text
	}
	return text[:count] + "..."
}

func TestServeLoopRejectsUnreadableFrameAsData(t *testing.T) {
	var output bytes.Buffer
	if err := serveLoop(strings.NewReader("{not json}\n"), &output); err != nil {
		t.Fatalf("a bad frame must not stop the loop with an error: %v", err)
	}
	frames := decodeFrames(t, output.String())
	if len(frames) != 1 || frames[0].OK || frames[0].Error == nil || frames[0].Error.Code != "invalid_request" {
		t.Fatalf("expected one invalid_request refusal, got %+v", frames)
	}
}

func TestServeLoopExitsCleanlyOnEOF(t *testing.T) {
	var output bytes.Buffer
	if err := serveLoop(strings.NewReader(""), &output); err != nil {
		t.Fatalf("an empty stdin is a clean shutdown, not an error: %v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("nothing was asked, so nothing may be answered: %q", output.String())
	}
}

func TestServeIfRequestedIgnoresNonServeArguments(t *testing.T) {
	// The c-shared binding builds from this same package and must stay inert when started
	// without the serve argument: main() doing something here would double-run the core.
	if serveIfRequested([]string{"findz"}) {
		t.Fatal("no arguments must not enter the serve loop")
	}
	if serveIfRequested([]string{"findz", "abi"}) {
		t.Fatal("an unknown first argument must not enter the serve loop")
	}
}

func TestReadFrameTrimsOnlyLineEndings(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader(`{"a":1}` + "\r\n"))
	frame, tooLarge, err := readFrame(reader)
	if tooLarge {
		t.Fatal("a short frame cannot be too large")
	}
	if err != nil {
		t.Fatalf("readFrame: %v", err)
	}
	if got := string(trimFrameEnd(frame)); got != `{"a":1}` {
		t.Fatalf("frame must keep its braces and drop only the line ending, got %q", got)
	}
}

func TestServeLoopAnswersAPIInfo(t *testing.T) {
	var output bytes.Buffer
	if err := serveLoop(strings.NewReader(requestFrame("s-api", "api.info", "{}")), &output); err != nil {
		t.Fatalf("serveLoop: %v", err)
	}

	frames := decodeFrames(t, output.String())
	if len(frames) != 1 {
		t.Fatalf("expected one response frame, got %d: %q", len(frames), output.String())
	}
	frame := frames[0]
	// The point of this test is the *method*, not the symbol: a QuickJS realm has no way to reach
	// `findz_api_info`, so the node's capability probe has to travel on the pipe like every other call.
	if frame.RequestID != "s-api" || !frame.OK {
		t.Fatalf("api.info must be answered as an envelope method: %+v", frame)
	}
	info, ok := frame.Result.(map[string]interface{})
	if !ok {
		t.Fatalf("api.info must answer an object, got %T", frame.Result)
	}
	if version, isNumber := info["abiVersion"].(float64); !isNumber || int(version) != findzABIVersion {
		t.Fatalf("api.info must report ABI version %d, got %#v", findzABIVersion, info["abiVersion"])
	}
	caps, isList := info["capabilities"].([]interface{})
	if !isList || len(caps) == 0 {
		t.Fatalf("api.info over the pipe must carry the capability list, got %#v", info["capabilities"])
	}
}
