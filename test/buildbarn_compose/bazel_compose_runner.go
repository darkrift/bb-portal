package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	invocationID = "d941d0cf-e0fb-48f7-aee8-4ff7dd7a1cf8"
	targetLabel  = "//:worker_completed_action"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()

	if err := run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	bazelFlag := flag.String("bazel", "", "Bazel binary provided by rules_bazel_integration_test")
	workspaceFlag := flag.String("workspace", "", "workspace path provided by rules_bazel_integration_test")
	flag.Parse()

	bazel := firstNonEmpty(os.Getenv("BIT_BAZEL_BINARY"), *bazelFlag)
	if bazel == "" {
		return errors.New("BIT_BAZEL_BINARY is not set")
	}
	if resolved, err := existingPath(bazel); err == nil {
		bazel = resolved
	}
	workspace := firstNonEmpty(os.Getenv("BIT_WORKSPACE_DIR"), *workspaceFlag)
	if workspace == "" {
		var err error
		workspace, err = createScratchWorkspace()
		if err != nil {
			return err
		}
	} else if st, err := os.Stat(workspace); err == nil && !st.IsDir() {
		workspace = filepath.Dir(workspace)
	} else if err != nil {
		return fmt.Errorf("stat workspace %q: %w", workspace, err)
	}

	ports, err := assignedPorts()
	if err != nil {
		return err
	}
	httpPort, err := findPort(ports, ".http")
	if err != nil {
		return err
	}
	besPort, err := findPort(ports, ".bes")
	if err != nil {
		return err
	}
	frontendPort, err := findPort(ports, ".frontend")
	if err != nil {
		return err
	}

	graphQLURL := fmt.Sprintf("http://127.0.0.1:%d/graphql", httpPort)
	if err := waitForGraphQL(ctx, graphQLURL); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(workspace, "BUILD.fixture")); err == nil {
		if err := materializeWorkspaceBuildFile(workspace); err != nil {
			return err
		}
	} else if _, err := os.Stat(filepath.Join(workspace, "BUILD.bazel")); err != nil {
		return err
	}

	bazelOutput, bazelErr := runChildBazel(ctx, bazel, workspace, besPort, frontendPort)
	if bazelErr == nil {
		return fmt.Errorf("expected %s to fail remotely, but Bazel succeeded\n%s", targetLabel, bazelOutput)
	}
	if !strings.Contains(bazelOutput, "Exit 34") && !strings.Contains(bazelOutput, "exit 34") {
		return fmt.Errorf("child Bazel failed before exercising the remote action: %w\n%s", bazelErr, bazelOutput)
	}

	if err := waitForStoredAction(ctx, graphQLURL); err != nil {
		return fmt.Errorf("%w\nchild Bazel output:\n%s", err, bazelOutput)
	}
	fmt.Printf("validated Buildbarn CAL action under invocation %s\n", invocationID)
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func materializeWorkspaceBuildFile(workspace string) error {
	input := filepath.Join(workspace, "BUILD.fixture")
	output := filepath.Join(workspace, "BUILD.bazel")
	data, err := os.ReadFile(input)
	if err != nil {
		return fmt.Errorf("read fixture BUILD file: %w", err)
	}
	if err := os.WriteFile(output, data, 0o644); err != nil {
		return fmt.Errorf("write workspace BUILD.bazel: %w", err)
	}
	return nil
}

func createScratchWorkspace() (string, error) {
	tmp := os.Getenv("TEST_TMPDIR")
	if tmp == "" {
		return "", errors.New("TEST_TMPDIR is not set")
	}
	workspace := filepath.Join(tmp, "child-workspace")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(workspace, "MODULE.bazel"), []byte(`module(name = "bb_portal_buildbarn_compose_fixture")
`), 0o644); err != nil {
		return "", err
	}
	for _, file := range []string{"BUILD.fixture"} {
		source, err := existingPath(filepath.Join("test/buildbarn_compose/bazel_workspace", file))
		if err != nil {
			return "", err
		}
		data, err := os.ReadFile(source)
		if err != nil {
			return "", err
		}
		name := file
		if file == "BUILD.fixture" {
			name = "BUILD.bazel"
		}
		if err := os.WriteFile(filepath.Join(workspace, name), data, 0o644); err != nil {
			return "", err
		}
	}
	return workspace, nil
}

func existingPath(path string) (string, error) {
	candidates := []string{path}
	if !filepath.IsAbs(path) {
		if cwd, err := os.Getwd(); err == nil {
			candidates = append(candidates, filepath.Join(cwd, path))
		}
		if runfilesDir := os.Getenv("RUNFILES_DIR"); runfilesDir != "" {
			candidates = append(candidates, filepath.Join(runfilesDir, path))
			if workspace := os.Getenv("TEST_WORKSPACE"); workspace != "" {
				candidates = append(candidates, filepath.Join(runfilesDir, workspace, path))
			}
			candidates = append(candidates, filepath.Join(runfilesDir, "_main", path))
			candidates = append(candidates, filepath.Join(runfilesDir, "com_github_buildbarn_bb_portal", path))
			if strings.Contains(path, "build_bazel_bazel_9_0_0") {
				candidates = append(candidates, filepath.Join(runfilesDir, "rules_bazel_integration_test++bazel_binaries+build_bazel_bazel_9_0_0", "bazel_binary"))
			}
		}
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("could not find %q in runfiles", path)
}

func assignedPorts() (map[string]int, error) {
	raw := os.Getenv("ASSIGNED_PORTS")
	if raw == "" {
		return nil, errors.New("ASSIGNED_PORTS is not set")
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil, fmt.Errorf("parse ASSIGNED_PORTS: %w", err)
	}
	ports := map[string]int{}
	for label, value := range values {
		var port int
		if err := json.Unmarshal(value, &port); err == nil {
			ports[label] = port
			continue
		}
		var portString string
		if err := json.Unmarshal(value, &portString); err != nil {
			return nil, fmt.Errorf("parse assigned port %s=%s: %w", label, value, err)
		}
		if _, err := fmt.Sscanf(portString, "%d", &port); err != nil {
			return nil, fmt.Errorf("parse assigned port %s=%q: %w", label, portString, err)
		}
		ports[label] = port
	}
	return ports, nil
}

func findPort(ports map[string]int, suffix string) (int, error) {
	var matches []string
	for label := range ports {
		if strings.HasSuffix(label, suffix) && strings.Contains(label, "//test/buildbarn_compose:buildbarn_compose") {
			matches = append(matches, label)
		}
	}
	if len(matches) != 1 {
		return 0, fmt.Errorf("expected one assigned port with suffix %q, got %v from %v", suffix, matches, ports)
	}
	return ports[matches[0]], nil
}

func waitForGraphQL(ctx context.Context, graphQLURL string) error {
	var lastErr error
	for deadline := time.Now().Add(2 * time.Minute); time.Now().Before(deadline); time.Sleep(500 * time.Millisecond) {
		lastErr = runGraphQL(ctx, graphQLURL, `query { __typename }`, nil, nil)
		if lastErr == nil {
			return nil
		}
	}
	return fmt.Errorf("GraphQL endpoint did not become ready: %w", lastErr)
}

func runChildBazel(ctx context.Context, bazel, workspace string, besPort, frontendPort int) (string, error) {
	outputRoot := filepath.Join(os.Getenv("TEST_TMPDIR"), "child-bazel-output")
	args := []string{
		"--output_user_root=" + outputRoot,
		"build",
		targetLabel,
		"--enable_bzlmod=true",
		"--registry=https://raw.githubusercontent.com/bazelbuild/bazel-central-registry/main",
		"--invocation_id=" + invocationID,
		fmt.Sprintf("--bes_backend=grpc://127.0.0.1:%d", besPort),
		fmt.Sprintf("--remote_executor=grpc://127.0.0.1:%d", frontendPort),
		"--remote_instance_name=",
		"--remote_default_exec_properties=purpose=integration-test",
		"--spawn_strategy=remote",
		"--strategy=Genrule=remote",
		"--remote_local_fallback=false",
		"--build_event_publish_all_actions",
		"--build_event_upload_max_retries=5",
		"--verbose_failures",
	}
	cmd := exec.CommandContext(ctx, bazel, args...)
	cmd.Dir = workspace
	cmd.Env = append(os.Environ(), "HOME="+os.Getenv("TEST_TMPDIR"))
	out, err := cmd.CombinedOutput()
	return string(out), err
}

type storedActionResponse struct {
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
	Data struct {
		GetBazelInvocation struct {
			InvocationID string `json:"invocationID"`
			Actions      []struct {
				Label            string `json:"label"`
				Success          *bool  `json:"success"`
				ExitCode         *int32 `json:"exitCode"`
				CompletedActions []struct {
					UUID             string `json:"uuid"`
					ToolInvocationID string `json:"toolInvocationID"`
					TargetID         string `json:"targetID"`
					ExitCode         *int32 `json:"exitCode"`
					DigestFunction   string `json:"digestFunction"`
				} `json:"completedActions"`
				ActionFiles []struct {
					Name string `json:"name"`
					URI  string `json:"uri"`
				} `json:"actionFiles"`
			} `json:"actions"`
		} `json:"getBazelInvocation"`
	} `json:"data"`
}

func waitForStoredAction(ctx context.Context, graphQLURL string) error {
	query := `query BuildbarnCompletedAction($invocationID: UUID!) {
  getBazelInvocation(invocationID: $invocationID) {
    invocationID
    actions {
      label
      success
      exitCode
      actionFiles { name uri }
      completedActions {
        uuid
        toolInvocationID
        targetID
        exitCode
        digestFunction
      }
    }
  }
}`
	var last storedActionResponse
	var lastErr error
	for deadline := time.Now().Add(2 * time.Minute); time.Now().Before(deadline); time.Sleep(500 * time.Millisecond) {
		last = storedActionResponse{}
		lastErr = runGraphQL(ctx, graphQLURL, query, map[string]any{"invocationID": invocationID}, &last)
		if lastErr != nil {
			continue
		}
		if err := validateStoredAction(last); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	if lastErr != nil {
		return lastErr
	}
	return fmt.Errorf("completed action was not stored under an Action: %+v", last)
}

func validateStoredAction(got storedActionResponse) error {
	if len(got.Errors) > 0 {
		return fmt.Errorf("GraphQL error: %s", got.Errors[0].Message)
	}
	inv := got.Data.GetBazelInvocation
	if inv.InvocationID != invocationID {
		return fmt.Errorf("invocation %q not visible yet", invocationID)
	}
	for _, action := range inv.Actions {
		if action.Label != targetLabel {
			continue
		}
		if action.Success == nil || *action.Success {
			return fmt.Errorf("action %s did not record failure: %+v", targetLabel, action)
		}
		if action.ExitCode == nil || *action.ExitCode == 0 {
			return fmt.Errorf("action %s did not record a failing exit code: %+v", targetLabel, action)
		}
		if len(action.CompletedActions) != 1 {
			return fmt.Errorf("action %s has %d completed actions", targetLabel, len(action.CompletedActions))
		}
		completed := action.CompletedActions[0]
		if completed.UUID == "" ||
			completed.ToolInvocationID != invocationID ||
			completed.TargetID != targetLabel ||
			completed.ExitCode == nil ||
			*completed.ExitCode != 34 ||
			completed.DigestFunction != "SHA256" {
			return fmt.Errorf("completed action fields did not match: %+v", completed)
		}
		if len(action.ActionFiles) == 0 {
			return fmt.Errorf("action %s has no action files", targetLabel)
		}
		return nil
	}
	return fmt.Errorf("action %s not visible yet: %+v", targetLabel, inv.Actions)
}

func runGraphQL(ctx context.Context, graphQLURL, query string, variables map[string]any, response any) error {
	requestBody, err := json.Marshal(map[string]any{
		"query":     query,
		"variables": variables,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, graphQLURL, bytes.NewReader(requestBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GraphQL returned HTTP %d: %s", resp.StatusCode, body)
	}
	if response == nil {
		return nil
	}
	if err := json.Unmarshal(body, response); err != nil {
		return fmt.Errorf("decode GraphQL response: %w: %s", err, body)
	}
	return nil
}
