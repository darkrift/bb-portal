package actionanalytics

import (
	"fmt"
	"io"
	"strconv"
	"time"
)

// State describes the lifecycle of asynchronous action analytics processing.
type State string

// Action analytics lifecycle states.
const (
	StatePending    State = "PENDING"
	StateProcessing State = "PROCESSING"
	StateCompleted  State = "COMPLETED"
	StateFailed     State = "FAILED"
)

// ExecutionLogStatus describes whether Bazel forwarded a compact execution log
// and whether bb-portal was able to process it.
type ExecutionLogStatus string

// Compact execution-log processing states.
const (
	ExecutionLogNotProvided ExecutionLogStatus = "NOT_PROVIDED"
	ExecutionLogProcessed   ExecutionLogStatus = "PROCESSED"
	ExecutionLogFailed      ExecutionLogStatus = "FAILED"
)

// Analytics is the complete GraphQL representation of an invocation's action
// analytics state and, once processing completes, its report.
type Analytics struct {
	State                      State
	FailureMessage             *string
	StartedAt                  *time.Time
	CompletedAt                *time.Time
	ExecutionLogStatus         ExecutionLogStatus
	ExecutionLogFailureMessage *string
	ExecutionLogActionCount    int64
	ExecutionLogMatchedActions int64
	Report                     *Report
}

// Report is a durable snapshot generated after an invocation has completed.
type Report struct {
	TotalActions             int64
	TimedActions             int64
	PeakConcurrentActions    int64
	AverageConcurrency       float64
	ObservedActionDuration   DurationStatistics
	LongestObservedActions   []*ActionStatistics
	Concurrency              []*ConcurrencyPoint
	SpawnMetricsActions      int64
	RemoteExecutionActions   int64
	RemoteQueueTime          DurationStatistics
	RemoteExecutionWallTime  DurationStatistics
	QueueToExecutionRatio    float64
	LongestQueueWaits        []*ActionStatistics
	SlowestExecutions        []*ActionStatistics
	PhaseStatistics          []*NamedDurationStatistics
	RemoteMnemonicStatistics []*GroupedActionStatistics
	RemotePlatformStatistics []*GroupedActionStatistics
}

// DurationStatistics contains distribution and aggregate information in
// milliseconds. Percentiles use the nearest-rank definition.
type DurationStatistics struct {
	SampleCount int64
	TotalInMs   int64
	MinimumInMs int64
	P50InMs     int64
	P90InMs     int64
	P95InMs     int64
	P99InMs     int64
	MaximumInMs int64
}

// NamedDurationStatistics describes one phase from Bazel's SpawnMetrics.
type NamedDurationStatistics struct {
	Name       string
	Statistics DurationStatistics
}

// GroupedActionStatistics aggregates queue and execution measurements for a
// mnemonic or remote execution platform.
type GroupedActionStatistics struct {
	Name              string
	ActionCount       int64
	QueueTime         DurationStatistics
	ExecutionWallTime DurationStatistics
}

// PlatformProperty is one execution-platform property reported by Bazel.
type PlatformProperty struct {
	Name  string
	Value string
}

// ActionStatistics identifies an action worth inspecting and includes the
// measurements needed to understand why it appears in the report.
type ActionStatistics struct {
	ActionExecutionID     int64
	Label                 string
	Mnemonic              string
	Runner                string
	Platform              []*PlatformProperty
	ObservedDurationInMs  *int64
	TotalTimeInMs         *int64
	QueueTimeInMs         *int64
	ExecutionWallTimeInMs *int64
	InputBytes            *int64
	InputFiles            *int64
	MemoryEstimateBytes   *int64
}

// ConcurrencyPoint is a point in the published-action concurrency series. The
// elapsed time is relative to the first timed action in the invocation.
type ConcurrencyPoint struct {
	ElapsedTimeInMs   int64
	ConcurrentActions int64
}

// Record contains the persisted action fields consumed by the analyzer.
type Record struct {
	ID                     int64
	Label                  string
	Mnemonic               string
	Runner                 string
	CacheHit               *bool
	StartTime              time.Time
	EndTime                time.Time
	Platform               map[string]string
	TotalTimeInMs          *int64
	ParseTimeInMs          *int64
	NetworkTimeInMs        *int64
	FetchTimeInMs          *int64
	QueueTimeInMs          *int64
	SetupTimeInMs          *int64
	UploadTimeInMs         *int64
	ExecutionWallTimeInMs  *int64
	ProcessOutputsTimeInMs *int64
	RetryTimeInMs          *int64
	InputBytes             *int64
	InputFiles             *int64
	MemoryEstimateBytes    *int64
}

func validState(value State) bool {
	switch value {
	case StatePending, StateProcessing, StateCompleted, StateFailed:
		return true
	default:
		return false
	}
}

// MarshalGQL implements graphql.Marshaler.
func (s State) MarshalGQL(w io.Writer) {
	_, _ = io.WriteString(w, strconv.Quote(string(s)))
}

// UnmarshalGQL implements graphql.Unmarshaler.
func (s *State) UnmarshalGQL(value any) error {
	stringValue, ok := value.(string)
	if !ok {
		return fmt.Errorf("ActionAnalyticsState %T must be a string", value)
	}
	state := State(stringValue)
	if !validState(state) {
		return fmt.Errorf("%s is not a valid ActionAnalyticsState", stringValue)
	}
	*s = state
	return nil
}

func validExecutionLogStatus(value ExecutionLogStatus) bool {
	switch value {
	case ExecutionLogNotProvided, ExecutionLogProcessed, ExecutionLogFailed:
		return true
	default:
		return false
	}
}

// MarshalGQL implements graphql.Marshaler.
func (s ExecutionLogStatus) MarshalGQL(w io.Writer) {
	_, _ = io.WriteString(w, strconv.Quote(string(s)))
}

// UnmarshalGQL implements graphql.Unmarshaler.
func (s *ExecutionLogStatus) UnmarshalGQL(value any) error {
	stringValue, ok := value.(string)
	if !ok {
		return fmt.Errorf("ExecutionLogStatus %T must be a string", value)
	}
	status := ExecutionLogStatus(stringValue)
	if !validExecutionLogStatus(status) {
		return fmt.Errorf("%s is not a valid ExecutionLogStatus", stringValue)
	}
	*s = status
	return nil
}
