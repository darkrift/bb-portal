package actionanalytics

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func int64Pointer(value int64) *int64 {
	return &value
}

func boolPointer(value bool) *bool {
	return &value
}

func TestAnalyze(t *testing.T) {
	invocationStart := time.Unix(100, 0)
	report := Analyze([]*Record{
		{
			ID:                    1,
			Label:                 "//example:slow_queue",
			Mnemonic:              "CppCompile",
			Runner:                "remote",
			CacheHit:              boolPointer(false),
			StartTime:             invocationStart,
			EndTime:               invocationStart.Add(10 * time.Second),
			Platform:              map[string]string{"container-image": "linux", "cpu": "x86_64"},
			TotalTimeInMs:         int64Pointer(9000),
			QueueTimeInMs:         int64Pointer(3000),
			ExecutionWallTimeInMs: int64Pointer(5000),
			InputBytes:            int64Pointer(4096),
			InputFiles:            int64Pointer(12),
		},
		{
			ID:                    2,
			Label:                 "//example:fast_remote",
			Mnemonic:              "GoCompilePkg",
			Runner:                "remote",
			CacheHit:              boolPointer(false),
			StartTime:             invocationStart.Add(2 * time.Second),
			EndTime:               invocationStart.Add(6 * time.Second),
			Platform:              map[string]string{"cpu": "x86_64"},
			TotalTimeInMs:         int64Pointer(4000),
			QueueTimeInMs:         int64Pointer(1000),
			ExecutionWallTimeInMs: int64Pointer(2000),
		},
		{
			ID:                    3,
			Label:                 "//example:local",
			Mnemonic:              "Symlink",
			Runner:                "local",
			CacheHit:              boolPointer(false),
			StartTime:             invocationStart.Add(5 * time.Second),
			EndTime:               invocationStart.Add(7 * time.Second),
			TotalTimeInMs:         int64Pointer(2000),
			ExecutionWallTimeInMs: int64Pointer(1500),
		},
	})

	require.EqualValues(t, 3, report.TotalActions)
	require.EqualValues(t, 3, report.TimedActions)
	require.Equal(t, DurationStatistics{
		SampleCount: 3,
		TotalInMs:   16000,
		MinimumInMs: 2000,
		P50InMs:     4000,
		P90InMs:     10000,
		P95InMs:     10000,
		P99InMs:     10000,
		MaximumInMs: 10000,
	}, report.ObservedActionDuration)
	require.EqualValues(t, 3, report.PeakConcurrentActions)
	require.InDelta(t, 1.6, report.AverageConcurrency, 0.0001)
	require.Equal(t, []*ConcurrencyPoint{
		{ElapsedTimeInMs: 0, ConcurrentActions: 1},
		{ElapsedTimeInMs: 2000, ConcurrentActions: 2},
		{ElapsedTimeInMs: 5000, ConcurrentActions: 3},
		{ElapsedTimeInMs: 6000, ConcurrentActions: 2},
		{ElapsedTimeInMs: 7000, ConcurrentActions: 1},
		{ElapsedTimeInMs: 10000, ConcurrentActions: 0},
	}, report.Concurrency)

	require.EqualValues(t, 3, report.SpawnMetricsActions)
	require.EqualValues(t, 2, report.RemoteExecutionActions)
	require.Equal(t, DurationStatistics{
		SampleCount: 2,
		TotalInMs:   4000,
		MinimumInMs: 1000,
		P50InMs:     1000,
		P90InMs:     3000,
		P95InMs:     3000,
		P99InMs:     3000,
		MaximumInMs: 3000,
	}, report.RemoteQueueTime)
	require.EqualValues(t, 7000, report.RemoteExecutionWallTime.TotalInMs)
	require.EqualValues(t, 2000, report.RemoteExecutionWallTime.P50InMs)
	require.EqualValues(t, 5000, report.RemoteExecutionWallTime.P95InMs)
	require.InDelta(t, 4.0/7.0, report.QueueToExecutionRatio, 0.0001)

	require.Equal(t, "//example:slow_queue", report.LongestObservedActions[0].Label)
	require.Equal(t, "//example:slow_queue", report.LongestQueueWaits[0].Label)
	require.Equal(t, "//example:slow_queue", report.SlowestExecutions[0].Label)
	require.Equal(t, []*PlatformProperty{
		{Name: "container-image", Value: "linux"},
		{Name: "cpu", Value: "x86_64"},
	}, report.LongestQueueWaits[0].Platform)
	require.Equal(t, "CppCompile", report.RemoteMnemonicStatistics[0].Name)
	require.Equal(t, "container-image=linux, cpu=x86_64", report.RemotePlatformStatistics[0].Name)
}

func TestAnalyzeWithoutActions(t *testing.T) {
	report := Analyze(nil)
	require.Zero(t, report.TotalActions)
	require.Zero(t, report.PeakConcurrentActions)
	require.Empty(t, report.LongestObservedActions)
	require.Empty(t, report.LongestQueueWaits)
	require.Empty(t, report.RemotePlatformStatistics)
}

func TestAnalyzePreservesConcurrencyTimelineBoundsWhenDownsampling(t *testing.T) {
	invocationStart := time.Unix(100, 0)
	records := make([]*Record, 0, 121)
	for index := 0; index < 121; index++ {
		startTime := invocationStart.Add(time.Duration(index*2) * time.Second)
		records = append(records, &Record{
			ID:        int64(index + 1),
			StartTime: startTime,
			EndTime:   startTime.Add(time.Second),
		})
	}

	report := Analyze(records)
	require.Len(t, report.Concurrency, maximumConcurrencyPoints)
	require.Equal(t, &ConcurrencyPoint{
		ElapsedTimeInMs:   0,
		ConcurrentActions: 1,
	}, report.Concurrency[0])
	require.Equal(t, &ConcurrencyPoint{
		ElapsedTimeInMs:   241000,
		ConcurrentActions: 0,
	}, report.Concurrency[len(report.Concurrency)-1])
}
