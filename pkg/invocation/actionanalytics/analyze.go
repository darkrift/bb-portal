package actionanalytics

import (
	"cmp"
	"math"
	"slices"
	"strings"
	"time"
)

const (
	maximumReportedActions   = 20
	maximumConcurrencyPoints = 120
)

type durationSample struct {
	record *Record
	value  int64
}

type concurrencyEvent struct {
	time  time.Time
	delta int64
}

func hasSpawnMetrics(record *Record) bool {
	return record.TotalTimeInMs != nil ||
		record.ParseTimeInMs != nil ||
		record.NetworkTimeInMs != nil ||
		record.FetchTimeInMs != nil ||
		record.QueueTimeInMs != nil ||
		record.SetupTimeInMs != nil ||
		record.UploadTimeInMs != nil ||
		record.ExecutionWallTimeInMs != nil ||
		record.ProcessOutputsTimeInMs != nil ||
		record.RetryTimeInMs != nil ||
		record.InputBytes != nil ||
		record.InputFiles != nil ||
		record.MemoryEstimateBytes != nil
}

func durationStatistics(values []int64) DurationStatistics {
	if len(values) == 0 {
		return DurationStatistics{}
	}
	values = slices.Clone(values)
	slices.Sort(values)
	statistics := DurationStatistics{
		SampleCount: int64(len(values)),
		MinimumInMs: values[0],
		MaximumInMs: values[len(values)-1],
	}
	for _, value := range values {
		statistics.TotalInMs += value
	}
	percentile := func(percent float64) int64 {
		index := int(math.Ceil(percent*float64(len(values)))) - 1
		return values[max(0, index)]
	}
	statistics.P50InMs = percentile(0.50)
	statistics.P90InMs = percentile(0.90)
	statistics.P95InMs = percentile(0.95)
	statistics.P99InMs = percentile(0.99)
	return statistics
}

func actionStatistics(record *Record) *ActionStatistics {
	platformNames := make([]string, 0, len(record.Platform))
	for name := range record.Platform {
		platformNames = append(platformNames, name)
	}
	slices.Sort(platformNames)
	platform := make([]*PlatformProperty, 0, len(platformNames))
	for _, name := range platformNames {
		platform = append(platform, &PlatformProperty{Name: name, Value: record.Platform[name]})
	}

	var observedDuration *int64
	if !record.StartTime.IsZero() && !record.EndTime.IsZero() && !record.EndTime.Before(record.StartTime) {
		value := record.EndTime.Sub(record.StartTime).Milliseconds()
		observedDuration = &value
	}
	return &ActionStatistics{
		ActionExecutionID:     record.ID,
		Label:                 record.Label,
		Mnemonic:              record.Mnemonic,
		Runner:                record.Runner,
		Platform:              platform,
		ObservedDurationInMs:  observedDuration,
		TotalTimeInMs:         record.TotalTimeInMs,
		QueueTimeInMs:         record.QueueTimeInMs,
		ExecutionWallTimeInMs: record.ExecutionWallTimeInMs,
		InputBytes:            record.InputBytes,
		InputFiles:            record.InputFiles,
		MemoryEstimateBytes:   record.MemoryEstimateBytes,
	}
}

func topActions(samples []durationSample, limit int) []*ActionStatistics {
	samples = slices.Clone(samples)
	slices.SortFunc(samples, func(left, right durationSample) int {
		if order := cmp.Compare(right.value, left.value); order != 0 {
			return order
		}
		return cmp.Compare(left.record.ID, right.record.ID)
	})
	if len(samples) > limit {
		samples = samples[:limit]
	}
	actions := make([]*ActionStatistics, 0, len(samples))
	for _, sample := range samples {
		actions = append(actions, actionStatistics(sample.record))
	}
	return actions
}

func concurrencyStatistics(records []*Record) (int64, float64, []*ConcurrencyPoint) {
	events := make([]concurrencyEvent, 0, len(records)*2)
	var totalDuration time.Duration
	var firstStart, lastEnd time.Time
	for _, record := range records {
		if record.StartTime.IsZero() || record.EndTime.IsZero() || record.EndTime.Before(record.StartTime) {
			continue
		}
		events = append(
			events,
			concurrencyEvent{time: record.StartTime, delta: 1},
			concurrencyEvent{time: record.EndTime, delta: -1},
		)
		totalDuration += record.EndTime.Sub(record.StartTime)
		if firstStart.IsZero() || record.StartTime.Before(firstStart) {
			firstStart = record.StartTime
		}
		if lastEnd.IsZero() || record.EndTime.After(lastEnd) {
			lastEnd = record.EndTime
		}
	}
	if len(events) == 0 {
		return 0, 0, nil
	}
	slices.SortFunc(events, func(left, right concurrencyEvent) int {
		if order := left.time.Compare(right.time); order != 0 {
			return order
		}
		// End actions before starting actions at the same instant.
		return cmp.Compare(left.delta, right.delta)
	})

	var concurrent, peak int64
	points := make([]*ConcurrencyPoint, 0, len(events))
	for index := 0; index < len(events); {
		timestamp := events[index].time
		for index < len(events) && events[index].time.Equal(timestamp) {
			concurrent += events[index].delta
			index++
		}
		peak = max(peak, concurrent)
		points = append(points, &ConcurrencyPoint{
			ElapsedTimeInMs:   timestamp.Sub(firstStart).Milliseconds(),
			ConcurrentActions: concurrent,
		})
	}

	if len(points) > maximumConcurrencyPoints {
		downsampled := make([]*ConcurrencyPoint, 0, maximumConcurrencyPoints)
		downsampled = append(downsampled, points[0])
		interior := points[1 : len(points)-1]
		interiorPointLimit := maximumConcurrencyPoints - 2
		for bucket := 0; bucket < interiorPointLimit; bucket++ {
			from := bucket * len(interior) / interiorPointLimit
			to := (bucket + 1) * len(interior) / interiorPointLimit
			point := *interior[from]
			for _, candidate := range interior[from:to] {
				if candidate.ConcurrentActions > point.ConcurrentActions {
					point = *candidate
				}
			}
			downsampled = append(downsampled, &point)
		}
		downsampled = append(downsampled, points[len(points)-1])
		points = downsampled
	}

	var average float64
	window := lastEnd.Sub(firstStart)
	if window > 0 {
		average = float64(totalDuration) / float64(window)
	}
	return peak, average, points
}

func groupName(platform map[string]string) string {
	if len(platform) == 0 {
		return "Unspecified platform"
	}
	names := make([]string, 0, len(platform))
	for name := range platform {
		names = append(names, name)
	}
	slices.Sort(names)
	properties := make([]string, 0, len(names))
	for _, name := range names {
		properties = append(properties, name+"="+platform[name])
	}
	return strings.Join(properties, ", ")
}

type groupedDurations struct {
	actionIDs map[int64]struct{}
	queue     []int64
	execution []int64
}

func groupedStatistics(records []*Record, name func(*Record) string) []*GroupedActionStatistics {
	groups := map[string]*groupedDurations{}
	for _, record := range records {
		group := name(record)
		if group == "" {
			group = "Unknown"
		}
		values, ok := groups[group]
		if !ok {
			values = &groupedDurations{actionIDs: map[int64]struct{}{}}
			groups[group] = values
		}
		values.actionIDs[record.ID] = struct{}{}
		if record.QueueTimeInMs != nil {
			values.queue = append(values.queue, *record.QueueTimeInMs)
		}
		if record.ExecutionWallTimeInMs != nil {
			values.execution = append(values.execution, *record.ExecutionWallTimeInMs)
		}
	}

	statistics := make([]*GroupedActionStatistics, 0, len(groups))
	for name, values := range groups {
		statistics = append(statistics, &GroupedActionStatistics{
			Name:              name,
			ActionCount:       int64(len(values.actionIDs)),
			QueueTime:         durationStatistics(values.queue),
			ExecutionWallTime: durationStatistics(values.execution),
		})
	}
	slices.SortFunc(statistics, func(left, right *GroupedActionStatistics) int {
		if order := cmp.Compare(right.QueueTime.TotalInMs, left.QueueTime.TotalInMs); order != 0 {
			return order
		}
		if order := cmp.Compare(right.ExecutionWallTime.TotalInMs, left.ExecutionWallTime.TotalInMs); order != 0 {
			return order
		}
		return cmp.Compare(left.Name, right.Name)
	})
	if len(statistics) > maximumReportedActions {
		statistics = statistics[:maximumReportedActions]
	}
	return statistics
}

// Analyze generates a bounded, durable report from all published action
// executions associated with a completed invocation.
func Analyze(records []*Record) *Report {
	report := &Report{TotalActions: int64(len(records))}
	observedDurations := make([]int64, 0, len(records))
	observedSamples := make([]durationSample, 0, len(records))
	var spawnMetricsActions int64
	remoteRecords := make([]*Record, 0, len(records))
	queueDurations := make([]int64, 0, len(records))
	queueSamples := make([]durationSample, 0, len(records))
	remoteExecutionDurations := make([]int64, 0, len(records))
	executionSamplesByDuration := make([]durationSample, 0, len(records))

	phaseValues := map[string][]int64{
		"Parse": {}, "Network": {}, "Fetch": {}, "Queue": {}, "Setup": {},
		"Upload": {}, "Execution": {}, "Process outputs": {}, "Retry": {},
	}
	for _, record := range records {
		if !record.StartTime.IsZero() && !record.EndTime.IsZero() && !record.EndTime.Before(record.StartTime) {
			duration := record.EndTime.Sub(record.StartTime).Milliseconds()
			observedDurations = append(observedDurations, duration)
			observedSamples = append(observedSamples, durationSample{record: record, value: duration})
		}

		if hasSpawnMetrics(record) {
			spawnMetricsActions++
		}
		if record.Runner == "remote" && (record.CacheHit == nil || !*record.CacheHit) {
			remoteRecords = append(remoteRecords, record)
			if record.QueueTimeInMs != nil {
				queueDurations = append(queueDurations, *record.QueueTimeInMs)
				queueSamples = append(queueSamples, durationSample{record: record, value: *record.QueueTimeInMs})
			}
			if record.ExecutionWallTimeInMs != nil {
				remoteExecutionDurations = append(remoteExecutionDurations, *record.ExecutionWallTimeInMs)
			}
		}
		if record.ExecutionWallTimeInMs != nil {
			executionSamplesByDuration = append(executionSamplesByDuration, durationSample{record: record, value: *record.ExecutionWallTimeInMs})
		}

		phases := []struct {
			name  string
			value *int64
		}{
			{"Parse", record.ParseTimeInMs},
			{"Network", record.NetworkTimeInMs},
			{"Fetch", record.FetchTimeInMs},
			{"Queue", record.QueueTimeInMs},
			{"Setup", record.SetupTimeInMs},
			{"Upload", record.UploadTimeInMs},
			{"Execution", record.ExecutionWallTimeInMs},
			{"Process outputs", record.ProcessOutputsTimeInMs},
			{"Retry", record.RetryTimeInMs},
		}
		for _, phase := range phases {
			if phase.value != nil {
				phaseValues[phase.name] = append(phaseValues[phase.name], *phase.value)
			}
		}
	}

	report.TimedActions = int64(len(observedDurations))
	report.ObservedActionDuration = durationStatistics(observedDurations)
	report.LongestObservedActions = topActions(observedSamples, maximumReportedActions)
	report.PeakConcurrentActions, report.AverageConcurrency, report.Concurrency = concurrencyStatistics(records)
	report.SpawnMetricsActions = spawnMetricsActions
	report.RemoteExecutionActions = int64(len(remoteRecords))
	report.RemoteQueueTime = durationStatistics(queueDurations)
	report.RemoteExecutionWallTime = durationStatistics(remoteExecutionDurations)
	if report.RemoteExecutionWallTime.TotalInMs > 0 {
		report.QueueToExecutionRatio = float64(report.RemoteQueueTime.TotalInMs) / float64(report.RemoteExecutionWallTime.TotalInMs)
	}
	report.LongestQueueWaits = topActions(queueSamples, maximumReportedActions)
	report.SlowestExecutions = topActions(executionSamplesByDuration, maximumReportedActions)

	phaseOrder := []string{"Queue", "Setup", "Execution", "Process outputs", "Fetch", "Upload", "Network", "Parse", "Retry"}
	for _, name := range phaseOrder {
		statistics := durationStatistics(phaseValues[name])
		if statistics.SampleCount > 0 {
			report.PhaseStatistics = append(report.PhaseStatistics, &NamedDurationStatistics{Name: name, Statistics: statistics})
		}
	}
	report.RemoteMnemonicStatistics = groupedStatistics(remoteRecords, func(record *Record) string { return record.Mnemonic })
	report.RemotePlatformStatistics = groupedStatistics(remoteRecords, func(record *Record) string { return groupName(record.Platform) })
	return report
}
