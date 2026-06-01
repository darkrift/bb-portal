package buildbarn_itest

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	bes "github.com/bazelbuild/bazel/src/main/java/com/google/devtools/build/lib/buildeventstream/proto"
	remoteexecution "github.com/bazelbuild/remote-apis/build/bazel/remote/execution/v2"
	cas_proto "github.com/buildbarn/bb-remote-execution/pkg/proto/cas"
	cal_proto "github.com/buildbarn/bb-remote-execution/pkg/proto/completedactionlogger"
	"github.com/stretchr/testify/require"
	build "google.golang.org/genproto/googleapis/devtools/build/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/anypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/bazelbuild/rules_go/go/runfiles"
)

const (
	bepRunfile       = "com_github_buildbarn_bb_portal/test/integrationtest/testdata/bepfiles/nextjs_test.bep.ndjson"
	calUUID          = "bb-portal-itest-completed-action"
	calTargetID      = "//next.js/pages:jest_test"
	calConfiguration = "358bd66fd0b6ce31004eacbfee54a783a7e66579667570851e40c121cbf266d9"
	calActionHash    = "1111111111111111111111111111111111111111111111111111111111111111"
	calStdoutHash    = "2222222222222222222222222222222222222222222222222222222222222222"
	calStderrHash    = "3333333333333333333333333333333333333333333333333333333333333333"
	graphQLRetryWait = 100 * time.Millisecond
)

func TestBESAndCompletedActionLoggerIngestion(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	ports := assignedPorts(t)
	httpURL := fmt.Sprintf("http://127.0.0.1:%d/graphql", findPort(t, ports, ":bb_portal:http"))
	besAddress := fmt.Sprintf("127.0.0.1:%d", findPort(t, ports, ":bb_portal:bes"))
	calAddress := fmt.Sprintf("127.0.0.1:%d", findPort(t, ports, ":bb_portal:cal"))

	bepPath, err := runfiles.Rlocation(bepRunfile)
	require.NoError(t, err)

	invocationID := uploadBEP(t, ctx, besAddress, bepPath)
	waitForAction(t, ctx, httpURL, invocationID)
	logCompletedAction(t, ctx, calAddress, invocationID)

	got := queryInvocation(t, ctx, httpURL, invocationID)
	require.Equal(t, invocationID, got.GetBazelInvocation.InvocationID)
	require.Greater(t, got.GetBazelInvocation.InvocationTargets.TotalCount, 0)
	require.Greater(t, got.FindTestSummaries.TotalCount, 0)

	action := findAction(t, got.GetBazelInvocation.Actions)
	require.Len(t, action.CompletedActions, 1)

	completedAction := action.CompletedActions[0]
	require.Equal(t, calUUID, completedAction.UUID)
	require.Equal(t, "", completedAction.InstanceName)
	require.Equal(t, calActionHash, completedAction.ActionDigestHash)
	require.EqualValues(t, 123, completedAction.ActionDigestSizeBytes)
	require.Equal(t, "SHA256", completedAction.DigestFunction)
	require.Equal(t, invocationID, completedAction.ToolInvocationID)
	require.Equal(t, "itest-correlated-invocations", completedAction.CorrelatedInvocationsID)
	require.Equal(t, calTargetID, completedAction.TargetID)
	require.Equal(t, "GoTest", completedAction.ActionMnemonic)
	require.False(t, completedAction.CacheHit)
	require.EqualValues(t, 0, completedAction.ExitCode)
	require.Equal(t, calStdoutHash, completedAction.StdoutHash)
	require.EqualValues(t, 10, completedAction.StdoutSizeBytes)
	require.Equal(t, calStderrHash, completedAction.StderrHash)
	require.EqualValues(t, 20, completedAction.StderrSizeBytes)
}

func findAction(t *testing.T, actions []actionQueryResult) actionQueryResult {
	t.Helper()
	for _, action := range actions {
		if action.Label == calTargetID {
			return action
		}
	}
	t.Fatalf("action %q not found in %+v", calTargetID, actions)
	return actionQueryResult{}
}

func assignedPorts(t *testing.T) map[string]int {
	t.Helper()
	var rawPorts map[string]any
	require.NoError(t, json.Unmarshal([]byte(os.Getenv("ASSIGNED_PORTS")), &rawPorts))
	require.NotEmpty(t, rawPorts)
	ports := make(map[string]int, len(rawPorts))
	for key, value := range rawPorts {
		switch v := value.(type) {
		case float64:
			ports[key] = int(v)
		case string:
			var port int
			_, err := fmt.Sscanf(v, "%d", &port)
			require.NoError(t, err)
			ports[key] = port
		default:
			t.Fatalf("assigned port %q has unsupported value %T", key, value)
		}
	}
	return ports
}

func findPort(t *testing.T, ports map[string]int, suffix string) int {
	t.Helper()
	for key, port := range ports {
		if strings.HasSuffix(key, suffix) {
			return port
		}
	}
	t.Fatalf("assigned port with suffix %q not found in %v", suffix, ports)
	return 0
}

func uploadBEP(t *testing.T, ctx context.Context, address, path string) string {
	t.Helper()

	conn, err := grpc.NewClient(
		address,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(64*1024*1024),
			grpc.MaxCallSendMsgSize(64*1024*1024),
		),
	)
	require.NoError(t, err)
	defer conn.Close()

	stream, err := build.NewPublishBuildEventClient(conn).PublishBuildToolEventStream(ctx)
	require.NoError(t, err)

	file, err := os.Open(path)
	require.NoError(t, err)
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	unmarshaler := protojson.UnmarshalOptions{DiscardUnknown: true}
	var sequenceNumber int64
	var invocationID string
	for scanner.Scan() {
		var event bes.BuildEvent
		require.NoError(t, unmarshaler.Unmarshal(scanner.Bytes(), &event))
		if invocationID == "" && event.GetStarted().GetUuid() != "" {
			invocationID = event.GetStarted().GetUuid()
		}
		sequenceNumber++
		sendBazelEvent(t, stream, invocationID, sequenceNumber, &event)
	}
	require.NoError(t, scanner.Err())
	require.NotEmpty(t, invocationID)

	sequenceNumber++
	sendBazelEvent(t, stream, invocationID, sequenceNumber, &bes.BuildEvent{
		Id: &bes.BuildEventId{
			Id: &bes.BuildEventId_ActionCompleted{
				ActionCompleted: &bes.BuildEventId_ActionCompletedId{
					Label: calTargetID,
					Configuration: &bes.BuildEventId_ConfigurationId{
						Id: calConfiguration,
					},
				},
			},
		},
		Payload: &bes.BuildEvent_Action{
			Action: &bes.ActionExecuted{
				Success:     true,
				Type:        "test",
				ExitCode:    0,
				CommandLine: []string{"synthetic", "successful", "action", "for", "CAL", "linkage"},
			},
		},
	})
	require.NoError(t, stream.CloseSend())

	var acks int64
	for {
		_, err := stream.Recv()
		if err == io.EOF {
			break
		}
		require.NoError(t, err)
		acks++
	}
	require.Equal(t, sequenceNumber, acks)
	return invocationID
}

func sendBazelEvent(
	t *testing.T,
	stream build.PublishBuildEvent_PublishBuildToolEventStreamClient,
	invocationID string,
	sequenceNumber int64,
	event *bes.BuildEvent,
) {
	t.Helper()
	bazelEvent, err := anypb.New(event)
	require.NoError(t, err)
	require.NoError(t, stream.Send(&build.PublishBuildToolEventStreamRequest{
		ProjectId: "",
		OrderedBuildEvent: &build.OrderedBuildEvent{
			StreamId: &build.StreamId{
				BuildId:      invocationID,
				InvocationId: invocationID,
				Component:    build.StreamId_TOOL,
			},
			SequenceNumber: sequenceNumber,
			Event: &build.BuildEvent{
				EventTime: timestamppb.Now(),
				Event: &build.BuildEvent_BazelEvent{
					BazelEvent: bazelEvent,
				},
			},
		},
	}))
}

func logCompletedAction(t *testing.T, ctx context.Context, address, invocationID string) {
	t.Helper()

	conn, err := grpc.NewClient(
		address,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(64*1024*1024),
			grpc.MaxCallSendMsgSize(64*1024*1024),
		),
	)
	require.NoError(t, err)
	defer conn.Close()

	stream, err := cal_proto.NewCompletedActionLoggerClient(conn).LogCompletedActions(ctx)
	require.NoError(t, err)

	requestMetadata, err := anypb.New(&remoteexecution.RequestMetadata{
		ToolInvocationId:        invocationID,
		CorrelatedInvocationsId: "itest-correlated-invocations",
		TargetId:                calTargetID,
		ActionMnemonic:          "GoTest",
	})
	require.NoError(t, err)

	require.NoError(t, stream.Send(&cal_proto.CompletedAction{
		Uuid:           calUUID,
		InstanceName:   "",
		DigestFunction: remoteexecution.DigestFunction_SHA256,
		HistoricalExecuteResponse: &cas_proto.HistoricalExecuteResponse{
			ActionDigest: &remoteexecution.Digest{
				Hash:      calActionHash,
				SizeBytes: 123,
			},
			ExecuteResponse: &remoteexecution.ExecuteResponse{
				CachedResult: false,
				Result: &remoteexecution.ActionResult{
					ExitCode: 0,
					StdoutDigest: &remoteexecution.Digest{
						Hash:      calStdoutHash,
						SizeBytes: 10,
					},
					StderrDigest: &remoteexecution.Digest{
						Hash:      calStderrHash,
						SizeBytes: 20,
					},
					ExecutionMetadata: &remoteexecution.ExecutedActionMetadata{
						QueuedTimestamp:          timestamppb.Now(),
						WorkerStartTimestamp:     timestamppb.Now(),
						WorkerCompletedTimestamp: timestamppb.Now(),
						AuxiliaryMetadata:        []*anypb.Any{requestMetadata},
					},
				},
			},
		},
	}))

	_, err = stream.Recv()
	require.NoError(t, err)
	require.NoError(t, stream.CloseSend())
}

type invocationQueryResponse struct {
	GetBazelInvocation struct {
		InvocationID      string `json:"invocationID"`
		BEPCompleted      bool   `json:"bepCompleted"`
		InvocationTargets struct {
			TotalCount int `json:"totalCount"`
		} `json:"invocationTargets"`
		Actions []actionQueryResult `json:"actions"`
	} `json:"getBazelInvocation"`
	FindTestSummaries struct {
		TotalCount int `json:"totalCount"`
	} `json:"findTestSummaries"`
}

type actionQueryResult struct {
	Label            string `json:"label"`
	CompletedActions []struct {
		UUID                    string `json:"uuid"`
		InstanceName            string `json:"instanceName"`
		ActionDigestHash        string `json:"actionDigestHash"`
		ActionDigestSizeBytes   int64  `json:"actionDigestSizeBytes"`
		DigestFunction          string `json:"digestFunction"`
		ToolInvocationID        string `json:"toolInvocationID"`
		CorrelatedInvocationsID string `json:"correlatedInvocationsID"`
		TargetID                string `json:"targetID"`
		ActionMnemonic          string `json:"actionMnemonic"`
		CacheHit                bool   `json:"cacheHit"`
		ExitCode                int32  `json:"exitCode"`
		StdoutHash              string `json:"stdoutHash"`
		StdoutSizeBytes         int64  `json:"stdoutSizeBytes"`
		StderrHash              string `json:"stderrHash"`
		StderrSizeBytes         int64  `json:"stderrSizeBytes"`
	} `json:"completedActions"`
}

func waitForAction(t *testing.T, ctx context.Context, graphQLURL, invocationID string) {
	t.Helper()
	query := `query ITestAction($invocationID: UUID!) {
  getBazelInvocation(invocationID: $invocationID) {
    invocationID
    actions { label }
  }
}`
	var lastErr error
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(graphQLRetryWait) {
		var got struct {
			GetBazelInvocation struct {
				InvocationID string `json:"invocationID"`
				Actions      []struct {
					Label string `json:"label"`
				} `json:"actions"`
			} `json:"getBazelInvocation"`
		}
		lastErr = runGraphQL(ctx, graphQLURL, query, map[string]any{"invocationID": invocationID}, &got)
		if lastErr != nil || got.GetBazelInvocation.InvocationID == "" {
			continue
		}
		for _, action := range got.GetBazelInvocation.Actions {
			if action.Label == calTargetID {
				return
			}
		}
	}
	require.NoError(t, lastErr)
	t.Fatalf("action %q for invocation %s did not become queryable", calTargetID, invocationID)
}

func queryInvocation(t *testing.T, ctx context.Context, graphQLURL, invocationID string) invocationQueryResponse {
	t.Helper()
	query := `query ITestInvocation($invocationID: UUID!) {
  getBazelInvocation(invocationID: $invocationID) {
    invocationID
    bepCompleted
    invocationTargets { totalCount }
    actions {
      label
      completedActions {
        uuid
        instanceName
        actionDigestHash
        actionDigestSizeBytes
        digestFunction
        toolInvocationID
        correlatedInvocationsID
        targetID
        actionMnemonic
        cacheHit
        exitCode
        stdoutHash
        stdoutSizeBytes
        stderrHash
        stderrSizeBytes
      }
    }
  }
  findTestSummaries(
    where: {
      hasInvocationTargetWith: [{
        hasBazelInvocationWith: [{ invocationID: $invocationID }]
      }]
    }
  ) {
    totalCount
  }
}`
	var lastErr error
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(graphQLRetryWait) {
		var got invocationQueryResponse
		lastErr = runGraphQL(ctx, graphQLURL, query, map[string]any{"invocationID": invocationID}, &got)
		if lastErr == nil && got.GetBazelInvocation.InvocationID != "" {
			for _, action := range got.GetBazelInvocation.Actions {
				if action.Label == calTargetID && len(action.CompletedActions) == 1 {
					return got
				}
			}
		}
	}
	require.NoError(t, lastErr)
	t.Fatalf("invocation %s did not become queryable with completed action", invocationID)
	return invocationQueryResponse{}
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
		return fmt.Errorf("graphql returned HTTP %d: %s", resp.StatusCode, body)
	}
	var payload struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err = json.Unmarshal(body, &payload); err != nil {
		return err
	}
	if len(payload.Errors) > 0 {
		return fmt.Errorf("graphql returned errors: %+v", payload.Errors)
	}
	return json.Unmarshal(payload.Data, response)
}
