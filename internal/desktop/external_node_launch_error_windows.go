//go:build windows

package desktop

import (
	"log"
	"os"
	"syscall"
	"unsafe"
)

var externalNodeLaunchUser32 = syscall.NewLazyDLL("user32.dll")
var externalNodeLaunchMessageBoxW = externalNodeLaunchUser32.NewProc("MessageBoxW")

func showExternalNodeLaunchError(message string) {
	if os.Getenv(externalNodeLaunchSmokeMarkerEnv) != "" {
		log.Printf("External node launch failed: %s", message)
		return
	}
	title, _ := syscall.UTF16PtrFromString("Xiranite external launch failed")
	body, _ := syscall.UTF16PtrFromString(message)
	const messageBoxIconError = 0x00000010
	const messageBoxOK = 0x00000000
	_, _, _ = externalNodeLaunchMessageBoxW.Call(0, uintptr(unsafePointer(body)), uintptr(unsafePointer(title)), messageBoxIconError|messageBoxOK)
}

func unsafePointer(value *uint16) uintptr {
	return uintptr(unsafe.Pointer(value))
}
