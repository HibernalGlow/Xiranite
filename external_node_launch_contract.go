package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

const externalNodeLaunchRequestVersion = 1

var externalNodeIdentifierPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
var externalNodeIntentPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)

type externalNodeLaunchRequest struct {
	Version   int                        `json:"version"`
	RequestID string                     `json:"requestId"`
	Source    string                     `json:"source"`
	NodeID    string                     `json:"nodeId"`
	Intent    string                     `json:"intent"`
	Targets   []externalNodeLaunchTarget `json:"targets"`
}

type externalNodeLaunchTarget struct {
	URI  string `json:"uri"`
	Kind string `json:"kind"`
}

type externalNodeLaunchDeclaration struct {
	Intents                  []externalNodeLaunchIntentDeclaration
	InstancePolicy           string
	RequiredHostCapabilities []string
	BackendFeatures          []string
}

type externalNodeLaunchIntentDeclaration struct {
	ID          string
	TargetKinds []string
	MaxTargets  int
}

// parseExternalNodeLaunchInvocation recognizes only public launch transports.
// An unrelated desktop invocation returns handled=false so the normal workspace
// application remains the default entry point.
func parseExternalNodeLaunchInvocation(args []string) (request externalNodeLaunchRequest, handled bool, err error) {
	if len(args) == 0 {
		return externalNodeLaunchRequest{}, false, nil
	}
	first := strings.TrimSpace(args[0])
	if strings.HasPrefix(strings.ToLower(first), "xiranite:") {
		request, err := parseExternalNodeLaunchURL(first)
		return request, true, err
	}
	if first != "--launch-node" {
		return externalNodeLaunchRequest{}, false, nil
	}
	request, err = parseExternalNodeLaunchArgv(args)
	return request, true, err
}

func parseExternalNodeLaunchArgv(args []string) (externalNodeLaunchRequest, error) {
	if len(args) < 6 || args[0] != "--launch-node" || args[2] != "--intent" || args[4] != "--" {
		return externalNodeLaunchRequest{}, fmt.Errorf("expected --launch-node <node-id> --intent <intent> -- <target>")
	}
	if len(args) == 5 {
		return externalNodeLaunchRequest{}, fmt.Errorf("external node launch requires at least one target")
	}
	request := newExternalNodeLaunchRequest("explorer", args[1], args[3])
	for _, rawPath := range args[5:] {
		target, err := normalizeExternalLaunchPath(rawPath)
		if err != nil {
			return externalNodeLaunchRequest{}, err
		}
		request.Targets = append(request.Targets, target)
	}
	if err := validateExternalNodeLaunchRequest(request); err != nil {
		return externalNodeLaunchRequest{}, err
	}
	return request, nil
}

func parseExternalNodeLaunchURL(rawURL string) (externalNodeLaunchRequest, error) {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil {
		return externalNodeLaunchRequest{}, fmt.Errorf("invalid xiranite launch URL: %w", err)
	}
	if !strings.EqualFold(parsed.Scheme, "xiranite") || !strings.EqualFold(parsed.Host, "launch") || parsed.User != nil || parsed.Fragment != "" {
		return externalNodeLaunchRequest{}, fmt.Errorf("xiranite launch URL must use xiranite://launch/<node-id>/<intent>")
	}
	parts := strings.Split(strings.Trim(parsed.EscapedPath(), "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return externalNodeLaunchRequest{}, fmt.Errorf("xiranite launch URL must include one node id and one intent")
	}
	nodeID, err := url.PathUnescape(parts[0])
	if err != nil {
		return externalNodeLaunchRequest{}, fmt.Errorf("invalid node id encoding: %w", err)
	}
	intent, err := url.PathUnescape(parts[1])
	if err != nil {
		return externalNodeLaunchRequest{}, fmt.Errorf("invalid intent encoding: %w", err)
	}
	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil {
		return externalNodeLaunchRequest{}, fmt.Errorf("invalid xiranite launch query: %w", err)
	}
	for key := range query {
		if key != "target" {
			return externalNodeLaunchRequest{}, fmt.Errorf("xiranite launch URL does not support query field %q", key)
		}
	}
	targets := query["target"]
	if len(targets) == 0 {
		return externalNodeLaunchRequest{}, fmt.Errorf("xiranite launch URL requires at least one target")
	}
	request := newExternalNodeLaunchRequest("url", nodeID, intent)
	for _, rawTarget := range targets {
		target, err := normalizeExternalLaunchFileURI(rawTarget)
		if err != nil {
			return externalNodeLaunchRequest{}, err
		}
		request.Targets = append(request.Targets, target)
	}
	if err := validateExternalNodeLaunchRequest(request); err != nil {
		return externalNodeLaunchRequest{}, err
	}
	return request, nil
}

func newExternalNodeLaunchRequest(source string, nodeID string, intent string) externalNodeLaunchRequest {
	return externalNodeLaunchRequest{
		Version:   externalNodeLaunchRequestVersion,
		RequestID: newExternalNodeLaunchRequestID(),
		Source:    source,
		NodeID:    strings.ToLower(strings.TrimSpace(nodeID)),
		Intent:    strings.ToLower(strings.TrimSpace(intent)),
	}
}

func newExternalNodeLaunchRequestID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err == nil {
		return hex.EncodeToString(buffer)
	}
	return fmt.Sprintf("fallback-%d", os.Getpid())
}

func validateExternalNodeLaunchRequest(request externalNodeLaunchRequest) error {
	if request.Version != externalNodeLaunchRequestVersion {
		return fmt.Errorf("unsupported external node launch request version %d", request.Version)
	}
	if request.Source != "argv" && request.Source != "explorer" && request.Source != "url" {
		return fmt.Errorf("unsupported external node launch source %q", request.Source)
	}
	if !externalNodeIdentifierPattern.MatchString(request.NodeID) {
		return fmt.Errorf("invalid external node id %q", request.NodeID)
	}
	if !externalNodeIntentPattern.MatchString(request.Intent) {
		return fmt.Errorf("invalid external launch intent %q", request.Intent)
	}
	declaration, found := generatedExternalNodeLaunchDeclarations[request.NodeID]
	if !found {
		return fmt.Errorf("node %q does not declare external launch support", request.NodeID)
	}
	intent, found := findExternalNodeLaunchIntent(declaration, request.Intent)
	if !found {
		return fmt.Errorf("node %q does not declare external launch intent %q", request.NodeID, request.Intent)
	}
	if len(request.Targets) == 0 || len(request.Targets) > intent.MaxTargets {
		return fmt.Errorf("external launch intent %q accepts 1-%d target(s), received %d", request.Intent, intent.MaxTargets, len(request.Targets))
	}
	for _, target := range request.Targets {
		if target.URI == "" || !containsExternalLaunchTargetKind(intent.TargetKinds, target.Kind) {
			return fmt.Errorf("external launch target kind %q is not allowed for %s/%s", target.Kind, request.NodeID, request.Intent)
		}
	}
	return nil
}

func findExternalNodeLaunchIntent(declaration externalNodeLaunchDeclaration, id string) (externalNodeLaunchIntentDeclaration, bool) {
	for _, intent := range declaration.Intents {
		if intent.ID == id {
			return intent, true
		}
	}
	return externalNodeLaunchIntentDeclaration{}, false
}

func containsExternalLaunchTargetKind(kinds []string, value string) bool {
	for _, kind := range kinds {
		if kind == value {
			return true
		}
	}
	return false
}

func normalizeExternalLaunchPath(rawPath string) (externalNodeLaunchTarget, error) {
	path := strings.TrimSpace(rawPath)
	if path == "" {
		return externalNodeLaunchTarget{}, fmt.Errorf("external launch target path is empty")
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return externalNodeLaunchTarget{}, fmt.Errorf("resolve external launch target %q: %w", path, err)
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return externalNodeLaunchTarget{}, fmt.Errorf("inspect external launch target %q: %w", absPath, err)
	}
	kind := "file"
	if info.IsDir() {
		kind = "directory"
	}
	uri, err := externalLaunchPathToFileURI(absPath)
	if err != nil {
		return externalNodeLaunchTarget{}, err
	}
	return externalNodeLaunchTarget{URI: uri, Kind: kind}, nil
}

func normalizeExternalLaunchFileURI(rawURI string) (externalNodeLaunchTarget, error) {
	parsed, err := url.ParseRequestURI(rawURI)
	if err != nil {
		return externalNodeLaunchTarget{}, fmt.Errorf("invalid external launch target URI: %w", err)
	}
	if !strings.EqualFold(parsed.Scheme, "file") || parsed.Opaque != "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return externalNodeLaunchTarget{}, fmt.Errorf("external launch target must be a local file: URI")
	}
	path, err := externalLaunchFileURIToPath(parsed)
	if err != nil {
		return externalNodeLaunchTarget{}, err
	}
	return normalizeExternalLaunchPath(path)
}

func externalLaunchPathToFileURI(path string) (string, error) {
	if path == "" || !filepath.IsAbs(path) {
		return "", fmt.Errorf("external launch path must be absolute")
	}
	if strings.HasPrefix(path, `\\`) {
		parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(path), "//"), "/")
		if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
			return "", fmt.Errorf("external launch UNC path must include server and share")
		}
		return (&url.URL{Scheme: "file", Host: parts[0], Path: "/" + strings.Join(parts[1:], "/")}).String(), nil
	}
	path = filepath.ToSlash(path)
	if filepath.VolumeName(path) != "" {
		path = "/" + path
	}
	return (&url.URL{Scheme: "file", Path: path}).String(), nil
}

func externalLaunchFileURIToPath(value *url.URL) (string, error) {
	if value == nil || value.Path == "" {
		return "", fmt.Errorf("external launch file URI path is empty")
	}
	if value.Host != "" && !strings.EqualFold(value.Host, "localhost") {
		if runtime.GOOS != "windows" {
			return "", fmt.Errorf("UNC external launch targets require Windows")
		}
		return `\\` + value.Host + filepath.FromSlash(value.Path), nil
	}
	path := filepath.FromSlash(value.Path)
	if runtime.GOOS == "windows" && len(path) >= 3 && path[0] == '\\' && path[2] == ':' {
		path = path[1:]
	}
	return path, nil
}
