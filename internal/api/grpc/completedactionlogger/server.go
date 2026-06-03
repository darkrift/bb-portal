package completedactionlogger

import (
	"context"
	"fmt"
	"io"
	"log/slog"

	remoteexecution "github.com/bazelbuild/remote-apis/build/bazel/remote/execution/v2"
	"github.com/buildbarn/bb-portal/ent/gen/ent"
	"github.com/buildbarn/bb-portal/ent/gen/ent/action"
	"github.com/buildbarn/bb-portal/ent/gen/ent/bazelinvocation"
	"github.com/buildbarn/bb-portal/ent/gen/ent/completedaction"
	"github.com/buildbarn/bb-portal/ent/gen/ent/instancename"
	"github.com/buildbarn/bb-portal/internal/database"
	"github.com/buildbarn/bb-portal/internal/database/dbauthservice"
	cal_proto "github.com/buildbarn/bb-remote-execution/pkg/proto/completedactionlogger"
	"github.com/buildbarn/bb-storage/pkg/util"
	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
)

// RegisterServer registers the CompletedActionLogger service.
func RegisterServer(s grpc.ServiceRegistrar, srv cal_proto.CompletedActionLoggerServer) {
	cal_proto.RegisterCompletedActionLoggerServer(s, srv)
}

// Server implements Buildbarn's CompletedActionLogger service.
type Server struct {
	cal_proto.UnimplementedCompletedActionLoggerServer

	db database.Client
}

// NewServer creates a CompletedActionLogger server that stores received
// CompletedAction messages and best-effort links them to BES invocations.
func NewServer(db database.Client) *Server {
	return &Server{db: db}
}

func requestMetadataFromCompletedAction(completedAction *cal_proto.CompletedAction) *remoteexecution.RequestMetadata {
	metadata := completedAction.GetHistoricalExecuteResponse().GetExecuteResponse().GetResult().GetExecutionMetadata()
	if metadata == nil {
		return nil
	}
	for _, auxiliaryMetadata := range metadata.AuxiliaryMetadata {
		var requestMetadata remoteexecution.RequestMetadata
		if err := auxiliaryMetadata.UnmarshalTo(&requestMetadata); err == nil {
			return &requestMetadata
		}
	}
	return nil
}

func setDigestFields(create *ent.CompletedActionCreate, completedAction *cal_proto.CompletedAction) {
	actionDigest := completedAction.GetHistoricalExecuteResponse().GetActionDigest()
	if actionDigest != nil {
		create.SetActionDigestHash(actionDigest.GetHash())
		create.SetActionDigestSizeBytes(actionDigest.GetSizeBytes())
	}
	if digestFunction := completedAction.GetDigestFunction(); digestFunction != remoteexecution.DigestFunction_UNKNOWN {
		create.SetDigestFunction(digestFunction.String())
	}
}

func setExecuteResponseFields(create *ent.CompletedActionCreate, completedAction *cal_proto.CompletedAction) {
	executeResponse := completedAction.GetHistoricalExecuteResponse().GetExecuteResponse()
	create.SetCacheHit(executeResponse.GetCachedResult())
	if status := executeResponse.GetStatus(); status != nil {
		create.SetStatusCode(status.GetCode())
		create.SetStatusMessage(status.GetMessage())
	}
	if result := executeResponse.GetResult(); result != nil {
		create.SetExitCode(result.GetExitCode())
		if stdoutDigest := result.GetStdoutDigest(); stdoutDigest != nil {
			create.SetStdoutHash(stdoutDigest.GetHash())
			create.SetStdoutSizeBytes(stdoutDigest.GetSizeBytes())
		}
		if stderrDigest := result.GetStderrDigest(); stderrDigest != nil {
			create.SetStderrHash(stderrDigest.GetHash())
			create.SetStderrSizeBytes(stderrDigest.GetSizeBytes())
		}
		if metadata := result.GetExecutionMetadata(); metadata != nil {
			if ts := metadata.GetQueuedTimestamp(); ts != nil {
				create.SetQueuedAt(ts.AsTime())
			}
			if ts := metadata.GetWorkerStartTimestamp(); ts != nil {
				create.SetWorkerStartAt(ts.AsTime())
			}
			if ts := metadata.GetWorkerCompletedTimestamp(); ts != nil {
				create.SetWorkerCompletedAt(ts.AsTime())
			}
		}
	}
}

func setRequestMetadataFields(create *ent.CompletedActionCreate, requestMetadata *remoteexecution.RequestMetadata) {
	if requestMetadata == nil {
		return
	}
	if toolInvocationID := requestMetadata.GetToolInvocationId(); toolInvocationID != "" {
		create.SetToolInvocationID(toolInvocationID)
	}
	if correlatedInvocationsID := requestMetadata.GetCorrelatedInvocationsId(); correlatedInvocationsID != "" {
		create.SetCorrelatedInvocationsID(correlatedInvocationsID)
	}
	if targetID := requestMetadata.GetTargetId(); targetID != "" {
		create.SetTargetID(targetID)
	}
	if actionMnemonic := requestMetadata.GetActionMnemonic(); actionMnemonic != "" {
		create.SetActionMnemonic(actionMnemonic)
	}
}

func hasRequestMetadataFields(requestMetadata *remoteexecution.RequestMetadata) bool {
	return requestMetadata != nil &&
		(requestMetadata.GetToolInvocationId() != "" ||
			requestMetadata.GetCorrelatedInvocationsId() != "" ||
			requestMetadata.GetTargetId() != "" ||
			requestMetadata.GetActionMnemonic() != "")
}

func setRequestMetadataUpdateFields(update *ent.CompletedActionUpdate, requestMetadata *remoteexecution.RequestMetadata) {
	if requestMetadata == nil {
		return
	}
	if toolInvocationID := requestMetadata.GetToolInvocationId(); toolInvocationID != "" {
		update.SetToolInvocationID(toolInvocationID)
	}
	if correlatedInvocationsID := requestMetadata.GetCorrelatedInvocationsId(); correlatedInvocationsID != "" {
		update.SetCorrelatedInvocationsID(correlatedInvocationsID)
	}
	if targetID := requestMetadata.GetTargetId(); targetID != "" {
		update.SetTargetID(targetID)
	}
	if actionMnemonic := requestMetadata.GetActionMnemonic(); actionMnemonic != "" {
		update.SetActionMnemonic(actionMnemonic)
	}
}

type completedActionLinks struct {
	bazelInvocationID *int64
	actionID          *int64
}

func (links completedActionLinks) hasFields() bool {
	return links.bazelInvocationID != nil || links.actionID != nil
}

func resolveInvocationLinks(ctx context.Context, tx *ent.Client, completedAction *cal_proto.CompletedAction, requestMetadata *remoteexecution.RequestMetadata) (completedActionLinks, bool, error) {
	var links completedActionLinks
	if requestMetadata == nil || requestMetadata.GetToolInvocationId() == "" {
		return links, false, nil
	}
	toolInvocationID, err := uuid.Parse(requestMetadata.GetToolInvocationId())
	if err != nil {
		return links, false, nil
	}
	bazelInvocation, err := tx.BazelInvocation.Query().
		Where(
			bazelinvocation.InvocationIDEQ(toolInvocationID),
			bazelinvocation.HasInstanceNameWith(instancename.Name(completedAction.GetInstanceName())),
		).
		Only(ctx)
	if ent.IsNotFound(err) {
		return links, false, status.Errorf(codes.Unavailable, "BazelInvocation %q for CompletedAction is not available yet", toolInvocationID)
	}
	if err != nil {
		return links, false, util.StatusWrap(err, "failed to query BazelInvocation for CompletedAction")
	}
	invocationID := bazelInvocation.ID
	links.bazelInvocationID = &invocationID

	if targetID := requestMetadata.GetTargetId(); targetID != "" {
		actionIDsQuery := tx.Action.Query().Where(
			action.BazelInvocationID(invocationID),
			action.LabelEQ(targetID),
		)
		if actionMnemonic := requestMetadata.GetActionMnemonic(); actionMnemonic != "" {
			actionIDsQuery = actionIDsQuery.Where(action.TypeEQ(actionMnemonic))
		}
		actionIDs, err := actionIDsQuery.Limit(2).IDs(ctx)
		if err != nil {
			return links, false, util.StatusWrap(err, "failed to query Action for CompletedAction")
		}
		if len(actionIDs) == 0 && requestMetadata.GetActionMnemonic() != "" {
			actionIDs, err = tx.Action.Query().
				Where(
					action.BazelInvocationID(invocationID),
					action.LabelEQ(targetID),
				).
				Limit(2).
				IDs(ctx)
			if err != nil {
				return links, false, util.StatusWrap(err, "failed to query Action for CompletedAction")
			}
		}
		if len(actionIDs) == 0 {
			if bazelInvocation.BuildEventPublishAllActions {
				return links, false, status.Errorf(codes.Unavailable, "Action %q for CompletedAction is not available yet", targetID)
			}
			return links, true, nil
		}
		if len(actionIDs) == 1 {
			links.actionID = &actionIDs[0]
		}
	}
	return links, false, nil
}

func setLinkFields(create *ent.CompletedActionCreate, links completedActionLinks) {
	if links.bazelInvocationID != nil {
		create.SetBazelInvocationID(*links.bazelInvocationID)
	}
	if links.actionID != nil {
		create.SetActionID(*links.actionID)
	}
}

func updateLinkFields(update *ent.CompletedActionUpdate, links completedActionLinks) {
	if links.bazelInvocationID != nil {
		update.SetBazelInvocationID(*links.bazelInvocationID)
	}
	if links.actionID != nil {
		update.SetActionID(*links.actionID)
	}
}

func (s *Server) saveCompletedAction(ctx context.Context, completedAction *cal_proto.CompletedAction) (bool, error) {
	ctx = dbauthservice.NewContextWithDbAuthServiceBypass(ctx)
	actionDigest := completedAction.GetHistoricalExecuteResponse().GetActionDigest()
	if actionDigest == nil || actionDigest.GetHash() == "" {
		return false, status.Error(codes.InvalidArgument, "CompletedAction does not contain an action digest")
	}
	completedActionUUID := completedAction.GetUuid()
	if completedActionUUID == "" {
		completedActionUUID = fmt.Sprintf("%s/%s/%d", completedAction.GetInstanceName(), actionDigest.GetHash(), actionDigest.GetSizeBytes())
	}
	historicalExecuteResponse, err := proto.Marshal(completedAction.GetHistoricalExecuteResponse())
	if err != nil {
		return false, util.StatusWrap(err, "failed to marshal HistoricalExecuteResponse")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, util.StatusWrap(err, "failed to create transaction")
	}
	defer tx.Rollback()

	requestMetadata := requestMetadataFromCompletedAction(completedAction)
	create := tx.Ent().CompletedAction.Create().
		SetUUID(completedActionUUID).
		SetInstanceName(completedAction.GetInstanceName()).
		SetHistoricalExecuteResponse(historicalExecuteResponse)
	setDigestFields(create, completedAction)
	setExecuteResponseFields(create, completedAction)
	setRequestMetadataFields(create, requestMetadata)
	links, drop, err := resolveInvocationLinks(ctx, tx.Ent(), completedAction, requestMetadata)
	if err != nil {
		return false, err
	}
	if drop {
		return false, nil
	}
	setLinkFields(create, links)

	if err = create.OnConflict().DoNothing().Exec(ctx); err != nil {
		return false, util.StatusWrap(err, "failed to save CompletedAction")
	}
	if hasRequestMetadataFields(requestMetadata) || links.hasFields() {
		update := tx.Ent().CompletedAction.Update().
			Where(completedaction.UUID(completedActionUUID))
		setRequestMetadataUpdateFields(update, requestMetadata)
		updateLinkFields(update, links)
		if err = update.Exec(ctx); err != nil {
			return false, util.StatusWrap(err, "failed to update CompletedAction")
		}
	}
	if err = tx.Commit(); err != nil {
		return false, util.StatusWrap(err, "failed to commit CompletedAction")
	}
	return true, nil
}

// LogCompletedActions receives completed actions from workers.
func (s *Server) LogCompletedActions(stream grpc.BidiStreamingServer[cal_proto.CompletedAction, emptypb.Empty]) error {
	for {
		completedAction, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		_, err = s.saveCompletedAction(stream.Context(), completedAction)
		if err != nil {
			slog.Warn(
				"Failed to store CompletedAction; not acknowledging",
				"uuid", completedAction.GetUuid(),
				"instanceName", completedAction.GetInstanceName(),
				"err", err,
			)
			return err
		}
		if err = stream.Send(&emptypb.Empty{}); err != nil {
			return err
		}
	}
}
