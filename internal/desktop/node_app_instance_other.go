//go:build !windows

package desktop

type nodeAppInstance struct{}

func acquireNodeAppInstance(_ string, _ string) (*nodeAppInstance, bool, error) {
	return &nodeAppInstance{}, true, nil
}

func (i *nodeAppInstance) SetFocusHandler(_ func()) {}
func (i *nodeAppInstance) Close()                   {}
