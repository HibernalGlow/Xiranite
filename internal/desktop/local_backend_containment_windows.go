//go:build windows

package desktop

import (
	"os"
	"os/exec"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var ntResumeProcess = windows.NewLazySystemDLL("ntdll.dll").NewProc("NtResumeProcess")

type localBackendProcessContainment struct {
	handle   windows.Handle
	closeErr error
	closeMu  sync.Mutex
}

func newLocalBackendProcessContainment() (*localBackendProcessContainment, error) {
	handle, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		handle,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		_ = windows.CloseHandle(handle)
		return nil, err
	}
	return &localBackendProcessContainment{handle: handle}, nil
}

func (*localBackendProcessContainment) Prepare(command *exec.Cmd) {
	if command == nil {
		return
	}
	if command.SysProcAttr == nil {
		command.SysProcAttr = &syscall.SysProcAttr{}
	}
	command.SysProcAttr.CreationFlags |= windows.CREATE_SUSPENDED
}

func (c *localBackendProcessContainment) AssignAndResume(process *os.Process) error {
	if c == nil || process == nil {
		return nil
	}
	var operationErr error
	if err := process.WithHandle(func(handle uintptr) {
		if err := windows.AssignProcessToJobObject(c.handle, windows.Handle(handle)); err != nil {
			operationErr = err
			return
		}
		status, _, _ := ntResumeProcess.Call(handle)
		if status != 0 {
			operationErr = windows.NTStatus(status)
		}
	}); err != nil {
		return err
	}
	return operationErr
}

func (c *localBackendProcessContainment) Close() error {
	if c == nil {
		return nil
	}
	c.closeMu.Lock()
	defer c.closeMu.Unlock()
	if c.handle == 0 {
		return c.closeErr
	}
	c.closeErr = windows.CloseHandle(c.handle)
	c.handle = 0
	return c.closeErr
}
