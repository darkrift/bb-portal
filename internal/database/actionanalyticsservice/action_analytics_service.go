package actionanalyticsservice

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/buildbarn/bb-portal/ent/gen/ent"
	"github.com/buildbarn/bb-portal/ent/gen/ent/actionexecution"
	"github.com/buildbarn/bb-portal/ent/gen/ent/bazelinvocation"
	"github.com/buildbarn/bb-portal/internal/database"
	"github.com/buildbarn/bb-portal/internal/database/dbauthservice"
	"github.com/buildbarn/bb-portal/pkg/invocation/actionanalytics"
	"github.com/buildbarn/bb-storage/pkg/clock"
	"github.com/buildbarn/bb-storage/pkg/program"
	"github.com/buildbarn/bb-storage/pkg/util"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const (
	defaultPollInterval      = time.Second
	defaultProcessingTimeout = 15 * time.Minute
)

// Service asynchronously computes action analytics for completed invocations.
type Service struct {
	db                database.Client
	clock             clock.Clock
	pollInterval      time.Duration
	processingTimeout time.Duration
	tracer            trace.Tracer
}

// New creates an action analytics service using production polling defaults.
func New(db database.Client, clock clock.Clock, tracerProvider trace.TracerProvider) *Service {
	return &Service{
		db:                db,
		clock:             clock,
		pollInterval:      defaultPollInterval,
		processingTimeout: defaultProcessingTimeout,
		tracer:            tracerProvider.Tracer("github.com/buildbarn/bb-portal/internal/database/actionanalyticsservice"),
	}
}

func recordFromAction(action *ent.ActionExecution) *actionanalytics.Record {
	return &actionanalytics.Record{
		ID:                     action.ID,
		Label:                  action.Label,
		Mnemonic:               action.Type,
		Runner:                 action.Runner,
		CacheHit:               action.CacheHit,
		StartTime:              action.StartTime,
		EndTime:                action.EndTime,
		Platform:               action.ExecutionPlatform,
		TotalTimeInMs:          action.SpawnTotalTimeInMs,
		ParseTimeInMs:          action.SpawnParseTimeInMs,
		NetworkTimeInMs:        action.SpawnNetworkTimeInMs,
		FetchTimeInMs:          action.SpawnFetchTimeInMs,
		QueueTimeInMs:          action.SpawnQueueTimeInMs,
		SetupTimeInMs:          action.SpawnSetupTimeInMs,
		UploadTimeInMs:         action.SpawnUploadTimeInMs,
		ExecutionWallTimeInMs:  action.SpawnExecutionWallTimeInMs,
		ProcessOutputsTimeInMs: action.SpawnProcessOutputsTimeInMs,
		RetryTimeInMs:          action.SpawnRetryTimeInMs,
		InputBytes:             action.SpawnInputBytes,
		InputFiles:             action.SpawnInputFiles,
		MemoryEstimateBytes:    action.SpawnMemoryEstimateBytes,
	}
}

func (s *Service) markFailed(ctx context.Context, invocationID int64, processingError error) error {
	err := s.db.Ent().BazelInvocation.Update().
		Where(
			bazelinvocation.ID(invocationID),
			bazelinvocation.ActionAnalyticsStateEQ(bazelinvocation.ActionAnalyticsState(actionanalytics.StateProcessing)),
		).
		SetActionAnalyticsState(bazelinvocation.ActionAnalyticsState(actionanalytics.StateFailed)).
		SetActionAnalyticsFailureMessage(processingError.Error()).
		SetActionAnalyticsCompletedAt(s.clock.Now()).
		ClearActionAnalyticsResult().
		Exec(ctx)
	if err != nil {
		return errors.Join(processingError, util.StatusWrap(err, "Failed to record action analytics failure"))
	}
	return processingError
}

func (s *Service) processInvocation(ctx context.Context, invocationID int64) (returnedError error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			returnedError = s.markFailed(ctx, invocationID, fmt.Errorf("action analytics processor panicked: %v", recovered))
		}
	}()

	actions, err := s.db.Ent().ActionExecution.Query().
		Where(actionexecution.BazelInvocationID(invocationID)).
		All(ctx)
	if err != nil {
		return s.markFailed(ctx, invocationID, util.StatusWrap(err, "Failed to load action executions"))
	}
	records := make([]*actionanalytics.Record, 0, len(actions))
	for _, action := range actions {
		records = append(records, recordFromAction(action))
	}
	report := actionanalytics.Analyze(records)

	updated, err := s.db.Ent().BazelInvocation.Update().
		Where(
			bazelinvocation.ID(invocationID),
			bazelinvocation.ActionAnalyticsStateEQ(bazelinvocation.ActionAnalyticsState(actionanalytics.StateProcessing)),
		).
		SetActionAnalyticsState(bazelinvocation.ActionAnalyticsState(actionanalytics.StateCompleted)).
		SetActionAnalyticsResult(report).
		SetActionAnalyticsCompletedAt(s.clock.Now()).
		ClearActionAnalyticsFailureMessage().
		Save(ctx)
	if err != nil {
		return s.markFailed(ctx, invocationID, util.StatusWrap(err, "Failed to save action analytics report"))
	}
	if updated != 1 {
		return s.markFailed(ctx, invocationID, util.StatusWrap(sql.ErrNoRows, "Action analytics claim was lost while saving the report"))
	}
	return nil
}

// ProcessNext claims and processes at most one completed invocation. The bool
// reports whether a job was claimed.
func (s *Service) ProcessNext(ctx context.Context) (bool, error) {
	ctx, span := s.tracer.Start(ctx, "ActionAnalyticsService.ProcessNext")
	defer span.End()

	invocationID, err := s.db.Sqlc().ClaimActionAnalytics(ctx, s.clock.Now().Add(-s.processingTimeout))
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "Failed to claim action analytics")
		return false, util.StatusWrap(err, "Failed to claim action analytics")
	}
	if err := s.processInvocation(ctx, invocationID); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "Failed to process action analytics")
		return true, err
	}
	return true, nil
}

// Start runs the asynchronous processor until the program group is stopped.
func (s *Service) Start(group program.Group) {
	group.Go(func(ctx context.Context, siblingsGroup, dependenciesGroup program.Group) error {
		ctx = dbauthservice.NewContextWithDbAuthServiceBypass(ctx)
		for {
			processed, err := s.ProcessNext(ctx)
			if err != nil {
				slog.WarnContext(ctx, "Failed to compute action analytics", "err", err)
			}
			if processed {
				continue
			}
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(s.pollInterval):
			}
		}
	})
}
