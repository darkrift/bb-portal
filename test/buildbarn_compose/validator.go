package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	bes "github.com/bazelbuild/bazel/src/main/java/com/google/devtools/build/lib/buildeventstream/proto"
	remoteexecution "github.com/bazelbuild/remote-apis/build/bazel/remote/execution/v2"
	build "google.golang.org/genproto/googleapis/devtools/build/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	graphQLURL               = "http://bb-portal:8080/graphql"
	besAddress               = "bb-portal:8981"
	remoteExecutionAddress   = "frontend:8980"
	postgresConnectionString = "postgres://bb_portal:bb_portal@postgres:5432/bb_portal?sslmode=disable"
	invocationID             = "d941d0cf-e0fb-48f7-aee8-4ff7dd7a1cf8"
	correlatedInvocationsID  = "compose-worker-cal"
	targetID                 = "//compose:worker_completed_action"
	actionMnemonic           = "ComposeWorkerAction"
	completedActionRetryWait = 500 * time.Millisecond
)

var bepEvents = []string{
	`{"id":{"started":{}},"children":[{"buildFinished":{}}],"started":{"uuid":"d941d0cf-e0fb-48f7-aee8-4ff7dd7a1cf8","startTimeMillis":"1772524334102","buildToolVersion":"9.0.0","command":"test","workingDirectory":"/workspace","workspaceDirectory":"/workspace","serverPid":"1","startTime":"2026-03-03T07:52:14.102Z","host":"compose","user":"validator"}}`,
	`{"id":{"buildFinished":{}},"finished":{"finishTimeMillis":"1772524335102","finishTime":"2026-03-03T07:52:15.102Z","exitCode":{"name":"SUCCESS","code":0},"overallSuccess":true}}`,
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	if err := run(ctx); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) error {
	if err := waitForGraphQL(ctx); err != nil {
		return err
	}
	if err := uploadBEP(ctx); err != nil {
		return err
	}
	actionDigest, err := executeActionWhenWorkerIsReady(ctx)
	if err != nil {
		return err
	}
	if err := waitForCompletedAction(ctx, actionDigest); err != nil {
		return err
	}
	log.Printf("validated worker completed-action ingestion for action %s/%d", actionDigest.Hash, actionDigest.SizeBytes)
	return nil
}

func executeActionWhenWorkerIsReady(ctx context.Context) (*remoteexecution.Digest, error) {
	var lastErr error
	for deadline := time.Now().Add(90 * time.Second); time.Now().Before(deadline); time.Sleep(time.Second) {
		actionDigest, err := executeAction(ctx)
		if err == nil {
			return actionDigest, nil
		}
		lastErr = err
		if !strings.Contains(err.Error(), "No workers exist") && !strings.Contains(err.Error(), "Unavailable") {
			return nil, err
		}
	}
	return nil, lastErr
}

func uploadBEP(ctx context.Context) error {
	conn, err := grpc.NewClient(
		besAddress,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(64*1024*1024),
			grpc.MaxCallSendMsgSize(64*1024*1024),
		),
	)
	if err != nil {
		return err
	}
	defer conn.Close()

	stream, err := build.NewPublishBuildEventClient(conn).PublishBuildToolEventStream(ctx)
	if err != nil {
		return err
	}

	unmarshaler := protojson.UnmarshalOptions{DiscardUnknown: true}
	for i, raw := range bepEvents {
		var event bes.BuildEvent
		if err := unmarshaler.Unmarshal([]byte(raw), &event); err != nil {
			return fmt.Errorf("unmarshal BEP event %d: %w", i, err)
		}
		bazelEvent, err := anypb.New(&event)
		if err != nil {
			return err
		}
		if err := stream.Send(&build.PublishBuildToolEventStreamRequest{
			OrderedBuildEvent: &build.OrderedBuildEvent{
				StreamId: &build.StreamId{
					BuildId:      invocationID,
					InvocationId: invocationID,
					Component:    build.StreamId_TOOL,
				},
				SequenceNumber: int64(i + 1),
				Event: &build.BuildEvent{
					EventTime: timestamppb.Now(),
					Event: &build.BuildEvent_BazelEvent{
						BazelEvent: bazelEvent,
					},
				},
			},
		}); err != nil {
			return err
		}
	}
	if err := stream.CloseSend(); err != nil {
		return err
	}

	for range bepEvents {
		if _, err := stream.Recv(); err != nil {
			return err
		}
	}
	_, err = stream.Recv()
	if err != io.EOF {
		return fmt.Errorf("expected BEP EOF, got %v", err)
	}
	return nil
}

func executeAction(ctx context.Context) (*remoteexecution.Digest, error) {
	conn, err := grpc.NewClient(
		remoteExecutionAddress,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(64*1024*1024),
			grpc.MaxCallSendMsgSize(64*1024*1024),
		),
	)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	commandDigest, commandBytes, err := marshalWithDigest(&remoteexecution.Command{
		Arguments:        []string{"/bin/sh", "-c", "printf worker-cal"},
		WorkingDirectory: "",
	})
	if err != nil {
		return nil, err
	}
	directoryDigest, directoryBytes, err := marshalWithDigest(&remoteexecution.Directory{})
	if err != nil {
		return nil, err
	}
	actionDigest, actionBytes, err := marshalWithDigest(&remoteexecution.Action{
		CommandDigest:   commandDigest,
		InputRootDigest: directoryDigest,
		DoNotCache:      true,
		Platform: &remoteexecution.Platform{
			Properties: []*remoteexecution.Platform_Property{
				{Name: "purpose", Value: "integration-test"},
			},
		},
		Timeout: durationpb.New(30 * time.Second),
	})
	if err != nil {
		return nil, err
	}

	if err := uploadBlobs(ctx, conn, map[*remoteexecution.Digest][]byte{
		commandDigest:   commandBytes,
		directoryDigest: directoryBytes,
		actionDigest:    actionBytes,
	}); err != nil {
		return nil, err
	}

	requestMetadataBytes, err := proto.Marshal(&remoteexecution.RequestMetadata{
		ToolInvocationId:        invocationID,
		CorrelatedInvocationsId: correlatedInvocationsID,
		TargetId:                targetID,
		ActionMnemonic:          actionMnemonic,
	})
	if err != nil {
		return nil, err
	}
	execCtx := metadata.NewOutgoingContext(ctx, metadata.Pairs(
		"build.bazel.remote.execution.v2.requestmetadata-bin",
		string(requestMetadataBytes),
	))

	stream, err := remoteexecution.NewExecutionClient(conn).Execute(execCtx, &remoteexecution.ExecuteRequest{
		InstanceName:    "",
		ActionDigest:    actionDigest,
		SkipCacheLookup: true,
		DigestFunction:  remoteexecution.DigestFunction_SHA256,
	})
	if err != nil {
		return nil, err
	}

	for {
		operation, err := stream.Recv()
		if err != nil {
			return nil, err
		}
		if !operation.GetDone() {
			continue
		}
		if operation.GetError().GetCode() != 0 {
			return nil, fmt.Errorf("remote execution operation failed: %s", operation.GetError().String())
		}
		var response remoteexecution.ExecuteResponse
		if err := operation.GetResponse().UnmarshalTo(&response); err != nil {
			return nil, err
		}
		if response.GetStatus().GetCode() != 0 {
			return nil, fmt.Errorf("remote execution response failed: %s", response.GetStatus().String())
		}
		if response.GetResult().GetExitCode() != 0 {
			return nil, fmt.Errorf("remote execution exit code = %d", response.GetResult().GetExitCode())
		}
		return actionDigest, nil
	}
}

func marshalWithDigest(message proto.Message) (*remoteexecution.Digest, []byte, error) {
	data, err := proto.Marshal(message)
	if err != nil {
		return nil, nil, err
	}
	sum := sha256.Sum256(data)
	return &remoteexecution.Digest{
		Hash:      fmt.Sprintf("%x", sum[:]),
		SizeBytes: int64(len(data)),
	}, data, nil
}

func uploadBlobs(ctx context.Context, conn *grpc.ClientConn, blobs map[*remoteexecution.Digest][]byte) error {
	requests := make([]*remoteexecution.BatchUpdateBlobsRequest_Request, 0, len(blobs))
	for digest, data := range blobs {
		requests = append(requests, &remoteexecution.BatchUpdateBlobsRequest_Request{
			Digest: digest,
			Data:   data,
		})
	}
	response, err := remoteexecution.NewContentAddressableStorageClient(conn).BatchUpdateBlobs(ctx, &remoteexecution.BatchUpdateBlobsRequest{
		Requests:       requests,
		DigestFunction: remoteexecution.DigestFunction_SHA256,
	})
	if err != nil {
		return err
	}
	for _, blobResponse := range response.GetResponses() {
		if blobResponse.GetStatus().GetCode() != 0 {
			return fmt.Errorf("upload blob %s/%d failed: %s", blobResponse.GetDigest().GetHash(), blobResponse.GetDigest().GetSizeBytes(), blobResponse.GetStatus().String())
		}
	}
	return nil
}

type completedActionQueryResponse struct {
	GetBazelInvocation struct {
		InvocationID     string `json:"invocationID"`
		BEPCompleted     bool   `json:"bepCompleted"`
		CompletedActions []struct {
			ActionDigestHash        string `json:"actionDigestHash"`
			ActionDigestSizeBytes   int64  `json:"actionDigestSizeBytes"`
			ActionMnemonic          string `json:"actionMnemonic"`
			CacheHit                bool   `json:"cacheHit"`
			CorrelatedInvocationsID string `json:"correlatedInvocationsID"`
			DigestFunction          string `json:"digestFunction"`
			ExitCode                int32  `json:"exitCode"`
			InstanceName            string `json:"instanceName"`
			TargetID                string `json:"targetID"`
			ToolInvocationID        string `json:"toolInvocationID"`
			UUID                    string `json:"uuid"`
		} `json:"completedActions"`
	} `json:"getBazelInvocation"`
}

func waitForCompletedAction(ctx context.Context, actionDigest *remoteexecution.Digest) error {
	query := `query ComposeCompletedAction($invocationID: UUID!) {
  getBazelInvocation(invocationID: $invocationID) {
    invocationID
    bepCompleted
    completedActions {
      actionDigestHash
      actionDigestSizeBytes
      actionMnemonic
      cacheHit
      correlatedInvocationsID
      digestFunction
      exitCode
      instanceName
      targetID
      toolInvocationID
      uuid
    }
  }
}`
	var lastErr error
	var lastGot completedActionQueryResponse
	for deadline := time.Now().Add(2 * time.Minute); time.Now().Before(deadline); time.Sleep(completedActionRetryWait) {
		var got completedActionQueryResponse
		lastErr = runGraphQL(ctx, query, map[string]any{"invocationID": invocationID}, &got)
		if lastErr != nil {
			continue
		}
		lastGot = got
		actions := got.GetBazelInvocation.CompletedActions
		if got.GetBazelInvocation.InvocationID == invocationID && len(actions) == 1 {
			action := actions[0]
			if action.ActionDigestHash != actionDigest.GetHash() ||
				action.ActionDigestSizeBytes != actionDigest.GetSizeBytes() ||
				action.ActionMnemonic != actionMnemonic ||
				action.CorrelatedInvocationsID != correlatedInvocationsID ||
				action.DigestFunction != "SHA256" ||
				action.ExitCode != 0 ||
				action.InstanceName != "" ||
				action.TargetID != targetID ||
				action.ToolInvocationID != invocationID ||
				action.UUID == "" {
				return fmt.Errorf("completed action did not match expected worker action: %+v", action)
			}
			return nil
		}
	}
	if lastErr != nil {
		return lastErr
	}
	log.Printf(
		"diagnostic graphql invocation_id=%q bep_completed=%v completed_actions=%+v",
		lastGot.GetBazelInvocation.InvocationID,
		lastGot.GetBazelInvocation.BEPCompleted,
		lastGot.GetBazelInvocation.CompletedActions,
	)
	if err := logCompletedActionDiagnostics(ctx, actionDigest); err != nil {
		log.Printf("failed to collect completed action diagnostics: %v", err)
	}
	return fmt.Errorf("completed action for invocation %s was not recorded", invocationID)
}

func logCompletedActionDiagnostics(ctx context.Context, actionDigest *remoteexecution.Digest) error {
	db, err := sql.Open("pgx", postgresConnectionString)
	if err != nil {
		return err
	}
	defer db.Close()

	var invocationDBID sql.NullInt64
	var invocationInstance sql.NullString
	var bepCompleted sql.NullBool
	if err := db.QueryRowContext(ctx, `
		SELECT bi.id, inames.name, bi.bep_completed
		FROM bazel_invocations bi
		LEFT JOIN instance_names inames ON inames.id = bi.instance_name_bazel_invocations
		WHERE bi.invocation_id = $1
	`, invocationID).Scan(&invocationDBID, &invocationInstance, &bepCompleted); err != nil {
		log.Printf("diagnostic bazel_invocations lookup failed: %v", err)
	} else {
		log.Printf(
			"diagnostic bazel_invocation id=%v instance=%q bep_completed=%v",
			nullInt64(invocationDBID),
			nullString(invocationInstance),
			nullBool(bepCompleted),
		)
	}

	rows, err := db.QueryContext(ctx, `
		SELECT
			id,
			uuid,
			instance_name,
			action_digest_hash,
			action_digest_size_bytes,
			digest_function,
			tool_invocation_id,
			correlated_invocations_id,
			target_id,
			action_mnemonic,
			exit_code,
			bazel_invocation_completed_actions,
			action_completed_actions
		FROM completed_actions
		WHERE action_digest_hash = $1 OR tool_invocation_id = $2
		ORDER BY id
	`, actionDigest.GetHash(), invocationID)
	if err != nil {
		return err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		count++
		var (
			id                      int64
			uuid                    string
			instanceName            string
			hash                    string
			sizeBytes               int64
			digestFunction          sql.NullString
			toolInvocationID        sql.NullString
			correlatedInvocationsID sql.NullString
			targetID                sql.NullString
			actionMnemonic          sql.NullString
			exitCode                sql.NullInt64
			bazelInvocationID       sql.NullInt64
			actionID                sql.NullInt64
		)
		if err := rows.Scan(
			&id,
			&uuid,
			&instanceName,
			&hash,
			&sizeBytes,
			&digestFunction,
			&toolInvocationID,
			&correlatedInvocationsID,
			&targetID,
			&actionMnemonic,
			&exitCode,
			&bazelInvocationID,
			&actionID,
		); err != nil {
			return err
		}
		log.Printf(
			"diagnostic completed_action id=%d uuid=%q instance=%q digest=%s/%d digest_function=%q tool_invocation_id=%q correlated_invocations_id=%q target_id=%q action_mnemonic=%q exit_code=%v bazel_invocation_id=%v action_id=%v",
			id,
			uuid,
			instanceName,
			hash,
			sizeBytes,
			nullString(digestFunction),
			nullString(toolInvocationID),
			nullString(correlatedInvocationsID),
			nullString(targetID),
			nullString(actionMnemonic),
			nullInt64(exitCode),
			nullInt64(bazelInvocationID),
			nullInt64(actionID),
		)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	log.Printf("diagnostic completed_action rows=%d", count)
	return nil
}

func nullString(value sql.NullString) string {
	if !value.Valid {
		return "<null>"
	}
	return value.String
}

func nullInt64(value sql.NullInt64) any {
	if !value.Valid {
		return "<null>"
	}
	return value.Int64
}

func nullBool(value sql.NullBool) any {
	if !value.Valid {
		return "<null>"
	}
	return value.Bool
}

func waitForGraphQL(ctx context.Context) error {
	query := `query Health { __typename }`
	var response struct {
		TypeName string `json:"__typename"`
	}
	var lastErr error
	for deadline := time.Now().Add(90 * time.Second); time.Now().Before(deadline); time.Sleep(completedActionRetryWait) {
		lastErr = runGraphQL(ctx, query, nil, &response)
		if lastErr == nil && response.TypeName == "Query" {
			return nil
		}
	}
	return fmt.Errorf("GraphQL did not become healthy: %w", lastErr)
}

func runGraphQL(ctx context.Context, query string, variables map[string]any, response any) error {
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
		return fmt.Errorf("graphql returned HTTP %d: %s", resp.StatusCode, string(body))
	}
	var payload struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return err
	}
	if len(payload.Errors) > 0 {
		messages := make([]string, 0, len(payload.Errors))
		for _, gqlErr := range payload.Errors {
			messages = append(messages, gqlErr.Message)
		}
		return fmt.Errorf("graphql returned errors: %s", strings.Join(messages, "; "))
	}
	return json.Unmarshal(payload.Data, response)
}
