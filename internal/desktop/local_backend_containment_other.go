//go:build !windows

package desktop

import (
	"os"
	"os/exec"
)

type localBackendProcessContainment struct{}

func newLocalBackendProcessContainment() (*localBackendProcessContainment, error) {
	return &localBackendProcessContainment{}, nil
}

func (*localBackendProcessContainment) Prepare(*exec.Cmd) {}

func (*localBackendProcessContainment) AssignAndResume(*os.Process) error { return nil }

func (*localBackendProcessContainment) Close() error { return nil }
