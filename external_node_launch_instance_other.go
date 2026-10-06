//go:build !windows

package main

import "fmt"

type externalNodeLaunchHostInstance struct{}

func acquireExternalNodeLaunchHostInstance(_ string, _ string) (*externalNodeLaunchHostInstance, bool, error) {
	return &externalNodeLaunchHostInstance{}, true, nil
}

func submitExternalNodeLaunchToExistingHost(_ string, _ externalNodeLaunchRequest, _ interface{}) (externalNodeLaunchAcknowledgement, error) {
	return externalNodeLaunchAcknowledgement{}, fmt.Errorf("external node host reuse is only available on Windows")
}

func (i *externalNodeLaunchHostInstance) SetRequestHandler(_ func(externalNodeLaunchRequest) externalNodeLaunchAcknowledgement) {
}
func (i *externalNodeLaunchHostInstance) Close() {}
