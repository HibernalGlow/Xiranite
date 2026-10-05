package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// The sidecar transport (ADR-0077): one request frame per line on stdin, one response frame
// per line on stdout, and the versioned envelope `protocol.go` already defines.
//
// ## Why the envelope is unchanged
//
// `findz_call` already took a JSON document and answered a JSON document (`ffi.go:28`), and
// `service.handle` (`service.go:33`) is the one place a method name becomes a result. Moving
// that boundary from an unmanaged C buffer to a pipe changes the framing, not the vocabulary,
// so `requestVersion`, `requestId`, the mutation receipts and every error code carry over
// verbatim and the existing Go tests still describe the shipped behaviour.
//
// ## Why frames are matched by order, not by id
//
// One request in, one response out, sequentially: the host holds the write side under one
// lock, so a response line always answers the request line before it. `requestId` stays what
// it was in the C ABI — an idempotency key (`service.go:56`) — not a correlation key. The old
// `bun:ffi` client made the same promise by queueing every call behind the previous one
// (`packages/findz-native/src/index.ts:85`).
//
// ## Why a frame is capped
//
// The writer is our own host, not a user, so an over-long line means a bug or a corrupt pipe.
// Refusing it keeps the reader from buffering whatever arrives, and the refusal is an error
// frame so the awaited host call fails as data rather than stalling the pump.

// maximumServeFrameBytes bounds one request frame: a query page or a rule tree is kilobytes.
const maximumServeFrameBytes = 1 << 20

// serveLoop answers request frames until the reader closes.
//
// Returning is the whole shutdown story: a cancelled run kills this process, and the index
// survives because it lives in SQLite — `database.go:74` flips a `running` task to `paused` on
// the next open, which is what makes killing a mid-scan an honest cancel rather than a
// corruption event.
func serveLoop(reader io.Reader, writer io.Writer) error {
	buffered := bufio.NewReader(reader)
	out := bufio.NewWriter(writer)
	for {
		frame, tooLarge, err := readFrame(buffered)
		if tooLarge {
			refused := failure("", "request_too_large",
				fmt.Errorf("request frame exceeds %d bytes", maximumServeFrameBytes), false, nil)
			if writeErr := writeFrame(out, refused); writeErr != nil {
				return writeErr
			}
		} else if trimmed := trimFrameEnd(frame); len(trimmed) > 0 {
			if writeErr := writeFrame(out, sharedFindzService.handle(trimmed)); writeErr != nil {
				return writeErr
			}
		}
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

// writeFrame emits one response and flushes it: the host is blocked waiting on a line, so a
// buffered answer is the same as no answer.
func writeFrame(out *bufio.Writer, response responseEnvelope) error {
	payload, err := json.Marshal(response)
	if err != nil {
		// A response that cannot be encoded is a core bug; report it as data instead of leaving
		// the host waiting for a line that will never arrive.
		payload = []byte(`{"ok":false,"error":{"code":"encode_failed","message":"The Findz response could not be encoded.","retryable":false}}`)
	}
	if _, err = out.Write(payload); err != nil {
		return err
	}
	if err = out.WriteByte('\n'); err != nil {
		return err
	}
	return out.Flush()
}

// readFrame reads one newline-terminated request, refusing anything past the cap.
//
// The cap is enforced while reading rather than after, so a runaway line is never buffered in
// full. `drainOverlongLine` then discards the rest of it: without that step one bad line
// desynchronises the pipe and every later frame is answered with a fragment of the first.
func readFrame(reader *bufio.Reader) ([]byte, bool, error) {
	var collected []byte
	for {
		chunk, err := reader.ReadSlice('\n')
		collected = append(collected, chunk...)
		if len(collected) > maximumServeFrameBytes {
			// 只有这一行还没读到结尾换行时才需要排空。触发上限的那一块经常**已经**带了 '\n'
			// （`err == nil`），那时这一行已经读完——再排空就会把**下一帧**整条吃掉，
			// 而这条正是 serve_test.go 里那条测抓出来的 bug。
			if err == bufio.ErrBufferFull {
				drainOverlongLine(reader)
			}
			return nil, true, nil
		}
		if err == bufio.ErrBufferFull {
			// The delimiter is not in sight yet: ReadSlice handed back a full internal buffer
			// and says "keep going". Treating that as the end of the frame would turn any
			// request longer than the 4 KiB buffer into a silently truncated one.
			continue
		}
		return collected, false, err
	}
}

// drainOverlongLine discards up to and including the next newline. A read error here is the
// caller's to report on the following turn, so it is deliberately not surfaced.
func drainOverlongLine(reader *bufio.Reader) {
	_, _ = reader.ReadString('\n')
}

func trimFrameEnd(frame []byte) []byte {
	for len(frame) > 0 && (frame[len(frame)-1] == '\n' || frame[len(frame)-1] == '\r') {
		frame = frame[:len(frame)-1]
	}
	return frame
}

// serveIfRequested is the executable entry point. The `c-shared` build keeps its empty
// `main()` because a DLL is loaded by a host rather than started, so the two shapes share one
// package and one service singleton.
func serveIfRequested(args []string) bool {
	if len(args) < 2 || args[1] != "serve" {
		return false
	}
	if err := serveLoop(os.Stdin, os.Stdout); err != nil {
		// stderr is drained by the host into the run's transcript, so the reason reaches an
		// operator instead of dying with the process.
		fmt.Fprintf(os.Stderr, "findz serve stopped: %v\n", err)
	}
	return true
}
