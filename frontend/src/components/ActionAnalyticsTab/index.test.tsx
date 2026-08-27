import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActionAnalyticsState,
  type BazelInvocationActionAnalyticsFragment,
  ExecutionLogStatus,
} from "@/graphql/__generated__/graphql";
import { ActionAnalyticsTab } from ".";

const pendingAnalytics: BazelInvocationActionAnalyticsFragment = {
  state: ActionAnalyticsState.Pending,
  failureMessage: null,
  startedAt: null,
  completedAt: null,
  executionLogStatus: ExecutionLogStatus.NotProvided,
  executionLogFailureMessage: null,
  executionLogActionCount: 0,
  executionLogMatchedActions: 0,
  report: null,
};

const completedWithoutExecutionLog: BazelInvocationActionAnalyticsFragment = {
  ...pendingAnalytics,
  state: ActionAnalyticsState.Completed,
  completedAt: "2026-08-27T12:00:00Z",
  report: {
    totalActions: 2,
    timedActions: 2,
    peakConcurrentActions: 2,
    averageConcurrency: 1.5,
    observedActionDuration: {
      p95InMs: 5000,
      maximumInMs: 5000,
    },
    longestObservedActions: [
      {
        actionExecutionID: 1,
        label: "//example:slow",
        mnemonic: "CppCompile",
        runner: "remote",
        observedDurationInMs: 5000,
      },
    ],
    concurrency: [
      { elapsedTimeInMs: 0, concurrentActions: 1 },
      { elapsedTimeInMs: 1000, concurrentActions: 2 },
      { elapsedTimeInMs: 5000, concurrentActions: 0 },
    ],
    spawnMetricsActions: 0,
    remoteExecutionActions: 0,
    remoteQueueTime: {
      sampleCount: 0,
      totalInMs: 0,
      p50InMs: 0,
      p95InMs: 0,
      maximumInMs: 0,
    },
    remoteExecutionWallTime: {
      sampleCount: 0,
      p95InMs: 0,
      maximumInMs: 0,
    },
    queueToExecutionRatio: 0,
    longestQueueWaits: [],
    slowestExecutions: [],
    phaseStatistics: [],
    remoteMnemonicStatistics: [],
    remotePlatformStatistics: [],
  },
};

describe("ActionAnalyticsTab", () => {
  it("explains that processing waits for invocation completion", () => {
    const html = renderToStaticMarkup(
      <ActionAnalyticsTab analytics={pendingAnalytics} bepCompleted={false} />,
    );

    expect(html).toContain(
      "Action analytics will start after the invocation is complete",
    );
    expect(html).toContain("waits until all BEP events have been ingested");
  });

  it("keeps BEP analytics and lists omitted execution-log statistics", () => {
    const html = renderToStaticMarkup(
      <ActionAnalyticsTab
        analytics={completedWithoutExecutionLog}
        bepCompleted={true}
      />,
    );

    expect(html).toContain("Execution-log statistics were not computed");
    expect(html).toContain("Remote queue-time percentiles");
    expect(html).toContain("--execution_log_compact_file=");
    expect(html).toContain("BEP-observed action activity");
    expect(html).toContain("Peak overlapping intervals");
    expect(html).toContain("Longest BEP-observed action intervals");
    expect(html).toContain("//example:slow");
    expect(html).not.toContain("Remote worker contention indicators");
  });

  it("identifies statistics excluded by partial execution-log correlation", () => {
    const html = renderToStaticMarkup(
      <ActionAnalyticsTab
        analytics={{
          ...completedWithoutExecutionLog,
          executionLogStatus: ExecutionLogStatus.Processed,
          executionLogActionCount: 4,
          executionLogMatchedActions: 2,
        }}
        bepCompleted={true}
      />,
    );

    expect(html).toContain(
      "Compact execution log was only partially correlated",
    );
    expect(html).toContain("2 of 4 published actions with primary outputs");
    expect(html).toContain(
      "Unmatched actions were excluded from execution-log-derived statistics",
    );
  });
});
