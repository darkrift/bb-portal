package completedactionlogger

import (
	"context"
	"io"

	remoteexecution "github.com/bazelbuild/remote-apis/build/bazel/remote/execution/v2"
	"github.com/buildbarn/bb-portal/ent/gen/ent"
	"github.com/buildbarn/bb-portal/ent/gen/ent/action"
	"github.com/buildbarn/bb-portal/ent/gen/ent/bazelinvocation"
	"github.com/buildbarn/bb-portal/ent/gen/ent/instancename"
	"github.com/buildbarn/bb-portal/internal/database"
	cal_proto "github.com/buildbarn/bb-remote-execution/pkg/proto/completedactionlogger"
	"github.com/buildbarn/bb-storage/pkg/util"
	"github.com/google/uuid"
	"google.golang.org/grpc"
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

func linkToInvocation(ctx context.Context, tx *ent.Client, create *ent.CompletedActionCreate, completedAction *cal_proto.CompletedAction, requestMetadata *remoteexecution.RequestMetadata) error {
	if requestMetadata == nil || requestMetadata.GetToolInvocationId() == "" {
		return nil
	}
	toolInvocationID, err := uuid.Parse(requestMetadata.GetToolInvocationId())
	if err != nil {
		return nil
	}
	invocationID, err := tx.BazelInvocation.Query().
		Where(
			bazelinvocation.InvocationIDEQ(toolInvocationID),
			bazelinvocation.HasInstanceNameWith(instancename.Name(completedAction.GetInstanceName())),
		).
		OnlyID(ctx)
	if ent.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return util.StatusWrap(err, "failed to query BazelInvocation for CompletedAction")
	}
	create.SetBazelInvocationID(invocationID)

	if targetID := requestMetadata.GetTargetId(); targetID != "" {
		actionID, err := tx.Action.Query().
			Where(
				action.BazelInvocationID(invocationID),
				action.LabelEQ(targetID),
			).
			OnlyID(ctx)
		if ent.IsNotFound(err) {
			return nil
		}
		if err != nil {
			return util.StatusWrap(err, "failed to query Action for CompletedAction")
		}
		create.SetActionID(actionID)
	}
	return nil
}

func (s *Server) saveCompletedAction(ctx context.Context, completedAction *cal_proto.CompletedAction) error {
	if completedAction.GetUuid() == "" {
		return nil
	}
	actionDigest := completedAction.GetHistoricalExecuteResponse().GetActionDigest()
	if actionDigest.GetHash() == "" {
		return nil
	}
	historicalExecuteResponse, err := proto.Marshal(completedAction.GetHistoricalExecuteResponse())
	if err != nil {
		return util.StatusWrap(err, "failed to marshal HistoricalExecuteResponse")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return util.StatusWrap(err, "failed to create transaction")
	}
	defer tx.Rollback()

	requestMetadata := requestMetadataFromCompletedAction(completedAction)
	create := tx.Ent().CompletedAction.Create().
		SetUUID(completedAction.GetUuid()).
		SetInstanceName(completedAction.GetInstanceName()).
		SetHistoricalExecuteResponse(historicalExecuteResponse)
	setDigestFields(create, completedAction)
	setExecuteResponseFields(create, completedAction)
	setRequestMetadataFields(create, requestMetadata)
	if err = linkToInvocation(ctx, tx.Ent(), create, completedAction, requestMetadata); err != nil {
		return err
	}

	if err = create.OnConflict().DoNothing().Exec(ctx); err != nil {
		return util.StatusWrap(err, "failed to save CompletedAction")
	}
	if err = tx.Commit(); err != nil {
		return util.StatusWrap(err, "failed to commit CompletedAction")
	}
	return nil
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
		if err = s.saveCompletedAction(stream.Context(), completedAction); err != nil {
			return err
		}
		if err = stream.Send(&emptypb.Empty{}); err != nil {
			return err
		}
	}
}
