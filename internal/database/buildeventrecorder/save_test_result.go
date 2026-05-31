package buildeventrecorder

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	bes "github.com/bazelbuild/bazel/src/main/java/com/google/devtools/build/lib/buildeventstream/proto"
	"github.com/buildbarn/bb-portal/ent/gen/ent"
	"github.com/buildbarn/bb-portal/ent/gen/ent/configuration"
	"github.com/buildbarn/bb-portal/ent/gen/ent/invocationtarget"
	"github.com/buildbarn/bb-portal/ent/gen/ent/target"
	"github.com/buildbarn/bb-portal/ent/gen/ent/testresult"
	"github.com/buildbarn/bb-portal/ent/gen/ent/testsummary"
	"github.com/buildbarn/bb-portal/internal/database"
	"github.com/buildbarn/bb-portal/internal/database/sqlc"
	"github.com/buildbarn/bb-portal/pkg/proto/configuration/bb_portal"
	"github.com/buildbarn/bb-storage/pkg/util"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// saveTestResultBatch efficiently saves a batch of target
// completed for a set of events where the corresponding target
// configured event has already been handled.
func (r *buildEventRecorder) saveTestResultBatch(ctx context.Context, batch []BuildEventWithInfo) error {
	if len(batch) == 0 {
		return nil
	}

	switch r.saveDataLevel.GetLevel().(type) {
	case *bb_portal.BuildEventStreamService_SaveDataLevel_Basic:
		return nil
	case *bb_portal.BuildEventStreamService_SaveDataLevel_BasicAndTarget:
		// Continue processing.
	default:
		return status.Error(codes.Internal, "Attempted to save target completed events when `saveDataLevel` is not recognized. This is probably a bug.")
	}

	ctx, span := r.tracer.Start(
		ctx,
		"BuildEventRecorder.saveTestResultBatch",
		trace.WithAttributes(
			attribute.Int("batch_size", len(batch)),
			attribute.String("invocation.id", r.InvocationID),
			attribute.String("invocation.instance_name", r.InstanceName),
		),
	)
	defer span.End()

	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return util.StatusWrap(err, "Failed to start transaction")
	}
	defer func() { tx.Rollback() }()

	row, err := tx.Sqlc().LockBazelInvocationCompletion(ctx, int64(r.InvocationDbID))
	if err != nil {
		return util.StatusWrap(err, "Failed to lock bep completed for invocation")
	}
	if row.BepCompleted {
		return status.Error(codes.InvalidArgument, "Attempted to configure targets for an invocation but the invocation was already completed.")
	}

	// Don't handle aborted events.
	filteredBatch := make([]BuildEventWithInfo, 0, len(batch))
	for _, x := range batch {
		if x.Event.GetTestResult() != nil {
			filteredBatch = append(filteredBatch, x)
		}
	}

	if err := createTestResultsBulk(ctx, r.InvocationDbID, r.InstanceNameDbID, tx, filteredBatch); err != nil {
		return util.StatusWrap(err, "Failed to bulk insert test results")
	}

	if err := saveTestResultFiles(ctx, tx, filteredBatch); err != nil {
		return util.StatusWrap(err, "Failed to bulk insert test result files")
	}

	if err := r.saveHandledEventsForBatch(ctx, batch, tx); err != nil {
		return util.StatusWrap(err, "Failed to bulk insert event metadata")
	}

	if err = tx.Commit(); err != nil {
		return util.StatusWrap(err, "Failed to commit batch of target configured events")
	}

	return nil
}

func createTestResultsBulk(ctx context.Context, invocationDbID, instanceNameDbID int64, tx database.Handle, batch []BuildEventWithInfo) error {
	params := sqlc.CreateTestResultsBulkParams{
		BazelInvocationID:    int64(invocationDbID),
		InstanceNameID:       int64(instanceNameDbID),
		Labels:               make([]string, len(batch)),
		ConfigIds:            make([]string, len(batch)),
		Runs:                 make([]int32, len(batch)),
		Shards:               make([]int32, len(batch)),
		Attempts:             make([]int32, len(batch)),
		Statuses:             make([]string, len(batch)),
		StatusDetailss:       make([]string, len(batch)),
		CachedLocallys:       make([]bool, len(batch)),
		TestAttemptStarts:    make([]time.Time, len(batch)),
		TestAttemptDurations: make([]int64, len(batch)),
		Warnings:             make([]string, len(batch)),
		Strategies:           make([]string, len(batch)),
		CachedRemotelys:      make([]bool, len(batch)),
		ExitCodes:            make([]int32, len(batch)),
		Hostnames:            make([]string, len(batch)),
		TimingBreakdowns:     make([]string, len(batch)),
	}

	for i, x := range batch {
		be := x.Event
		testResultID := be.GetId().GetTestResult()
		testResult := be.GetTestResult()

		if testResultID == nil {
			return status.Error(codes.InvalidArgument, "Test result event does not have test result identifier set.")
		}
		if testResult == nil {
			return status.Error(codes.InvalidArgument, "Test result event does not have test result set.")
		}
		params.Labels[i] = testResultID.Label
		params.ConfigIds[i] = testResultID.Configuration.GetId()
		params.Runs[i] = testResultID.Run
		params.Shards[i] = testResultID.Shard
		params.Attempts[i] = testResultID.Attempt
		params.StatusDetailss[i] = testResult.StatusDetails
		params.CachedLocallys[i] = testResult.CachedLocally

		if status, ok := bes.TestStatus_name[int32(testResult.Status)]; ok {
			params.Statuses[i] = status
		}

		if testResult.TestAttemptStart != nil && testResult.TestAttemptStart.AsTime().IsZero() == false {
			params.TestAttemptStarts[i] = testResult.TestAttemptStart.AsTime()
		}
		if testResult.TestAttemptDuration != nil && testResult.TestAttemptDuration.AsDuration() != 0 {
			params.TestAttemptDurations[i] = int64(testResult.TestAttemptDuration.AsDuration().Milliseconds())
		}

		// Default to NULL. An empty string will make the database sad.
		params.Warnings[i] = "null"
		if testResult.Warning != nil {
			if warningsJSON, err := json.Marshal(testResult.Warning); err == nil {
				params.Warnings[i] = string(warningsJSON)
			}
		}

		if ei := testResult.GetExecutionInfo(); ei != nil {
			params.Strategies[i] = ei.Strategy
			params.CachedRemotelys[i] = ei.CachedRemotely
			params.ExitCodes[i] = ei.ExitCode
			params.Hostnames[i] = ei.Hostname

			params.TimingBreakdowns[i] = "null"
			tb := createTimingBreakdownRecursive(ei.TimingBreakdown)
			if tb != nil {
				if tbJSON, err := json.Marshal(tb); err == nil {
					params.TimingBreakdowns[i] = string(tbJSON)
				}
			}
		}
	}

	affectedRows, err := tx.Sqlc().CreateTestResultsBulk(ctx, params)
	if err != nil {
		return util.StatusWrap(err, "Failed to bulk insert test results")
	}
	if int(affectedRows) != len(batch) {
		return status.Errorf(codes.Internal, "Expected to insert %d test results, but only %d were inserted", len(batch), affectedRows)
	}

	return nil
}

func saveTestResultFiles(ctx context.Context, tx database.Handle, batch []BuildEventWithInfo) error {
	for _, x := range batch {
		be := x.Event
		testResultID := be.GetId().GetTestResult()
		testResult := be.GetTestResult()

		if testResultID == nil || testResult == nil {
			continue
		}

		insertedTestResult, err := tx.Ent().TestResult.Query().Where(
			testresult.RunEQ(testResultID.Run),
			testresult.ShardEQ(testResultID.Shard),
			testresult.AttemptEQ(testResultID.Attempt),
			testresult.HasTestSummaryWith(
				testsummary.HasInvocationTargetWith(
					invocationtarget.HasTargetWith(
						target.LabelEQ(testResultID.Label),
						target.AspectEQ(""),
					),
					invocationtarget.HasConfigurationWith(
						configuration.ConfigurationIDEQ(testResultID.Configuration.GetId()),
					),
				),
			),
		).Only(ctx)
		if err != nil {
			return util.StatusWrap(err, "Failed to resolve inserted test result")
		}

		createdFiles := make([]*ent.TestResultFile, 0, len(testResult.GetTestActionOutput()))
		for _, file := range testResult.GetTestActionOutput() {
			if !shouldPersistTestResultFile(file) {
				continue
			}
			createdFile, err := tx.Ent().TestResultFile.Create().
				SetName(file.GetName()).
				SetURI(file.GetUri()).
				Save(ctx)
			if err != nil {
				return util.StatusWrap(err, "Failed to insert test result file")
			}
			createdFiles = append(createdFiles, createdFile)
		}

		if len(createdFiles) > 0 {
			if _, err := insertedTestResult.Update().AddTestResultFiles(createdFiles...).Save(ctx); err != nil {
				return util.StatusWrap(err, "Failed to attach test result files")
			}
		}
	}
	return nil
}

func shouldPersistTestResultFile(file *bes.File) bool {
	if file == nil {
		return false
	}
	uri := file.GetUri()
	if uri == "" {
		return false
	}
	if strings.HasPrefix(uri, "file://") {
		return false
	}
	return true
}

type timingBreakdown struct {
	Children       []*timingBreakdown
	Name           string
	DurationMillis int64
}

func createTimingBreakdownRecursive(tb *bes.TestResult_ExecutionInfo_TimingBreakdown) *timingBreakdown {
	if tb == nil {
		return nil
	}

	if tb.Time == nil || !tb.Time.IsValid() {
		return nil
	}
	durationMillis := tb.Time.AsDuration().Milliseconds()

	children := make([]*timingBreakdown, 0, len(tb.Child))
	for _, child := range tb.Child {
		newChild := createTimingBreakdownRecursive(child)
		if newChild != nil {
			children = append(children, newChild)
		}
	}
	return &timingBreakdown{
		Name:           tb.Name,
		DurationMillis: durationMillis,
		Children:       children,
	}
}
