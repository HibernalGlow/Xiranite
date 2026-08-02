//go:build windows

package main

import (
	"fmt"
	"runtime"
	"syscall"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sys/windows"
)

const variantTypeWideString = 31

var (
	shell32                         = windows.NewLazySystemDLL("shell32.dll")
	shGetPropertyStoreForWindowProc = shell32.NewProc("SHGetPropertyStoreForWindow")
	propertyStoreIID                = windows.GUID{Data1: 0x886d8eeb, Data2: 0x8cf2, Data3: 0x4446, Data4: [8]byte{0x8d, 0x02, 0xcd, 0xba, 0x1d, 0xbd, 0xcf, 0x99}}
	appUserModelIDPropertyKey       = propertyKey{
		FormatID:   windows.GUID{Data1: 0x9f4c2855, Data2: 0x9f79, Data3: 0x4b39, Data4: [8]byte{0xa8, 0xd0, 0xe1, 0xd4, 0x2d, 0xe1, 0xd5, 0xf3}},
		PropertyID: 5,
	}
)

type propertyKey struct {
	FormatID   windows.GUID
	PropertyID uint32
}

type propertyVariant struct {
	VariantType uint16
	Reserved1   uint16
	Reserved2   uint16
	Reserved3   uint16
	Value       uintptr
	Value2      uintptr
}

type propertyStore struct {
	VirtualTable *propertyStoreVirtualTable
}

type propertyStoreVirtualTable struct {
	QueryInterface uintptr
	AddRef         uintptr
	Release        uintptr
	GetCount       uintptr
	GetAt          uintptr
	GetValue       uintptr
	SetValue       uintptr
	Commit         uintptr
}

func setWindowTaskbarIdentity(window *application.WebviewWindow, windowID string) error {
	nativeWindow := window.NativeWindow()
	if nativeWindow == nil {
		return fmt.Errorf("native window handle is unavailable")
	}

	var store *propertyStore
	hresult, _, _ := shGetPropertyStoreForWindowProc.Call(
		uintptr(nativeWindow),
		uintptr(unsafe.Pointer(&propertyStoreIID)),
		uintptr(unsafe.Pointer(&store)),
	)
	if failedHRESULT(hresult) {
		return fmt.Errorf("SHGetPropertyStoreForWindow failed: HRESULT 0x%08X", uint32(hresult))
	}
	if store == nil {
		return fmt.Errorf("SHGetPropertyStoreForWindow returned no property store")
	}
	defer syscall.SyscallN(store.VirtualTable.Release, uintptr(unsafe.Pointer(store)))

	appID, err := windows.UTF16PtrFromString(componentWindowAppUserModelID(windowID))
	if err != nil {
		return fmt.Errorf("encode AppUserModelID: %w", err)
	}
	value := propertyVariant{
		VariantType: variantTypeWideString,
		Value:       uintptr(unsafe.Pointer(appID)),
	}
	hresult, _, _ = syscall.SyscallN(
		store.VirtualTable.SetValue,
		uintptr(unsafe.Pointer(store)),
		uintptr(unsafe.Pointer(&appUserModelIDPropertyKey)),
		uintptr(unsafe.Pointer(&value)),
	)
	runtime.KeepAlive(appID)
	if failedHRESULT(hresult) {
		return fmt.Errorf("set System.AppUserModel.ID failed: HRESULT 0x%08X", uint32(hresult))
	}
	return nil
}

func failedHRESULT(result uintptr) bool {
	return int32(uint32(result)) < 0
}
