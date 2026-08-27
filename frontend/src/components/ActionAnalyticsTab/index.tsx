import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Card,
  Col,
  Flex,
  Row,
  Space,
  Statistic,
  Table,
  type TableColumnsType,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  ActionAnalyticsState,
  type BazelInvocationActionAnalyticsFragment,
  ExecutionLogStatus,
} from "@/graphql/__generated__/graphql";
import { readableFileSize } from "@/utils/filesize";
import { readableDurationFromMilliseconds } from "@/utils/time";

interface Props {
  analytics: BazelInvocationActionAnalyticsFragment;
  bepCompleted: boolean;
}

type AnalyticsReport = NonNullable<
  BazelInvocationActionAnalyticsFragment["report"]
>;
type ActionRow = AnalyticsReport["longestQueueWaits"][number];
type ObservedActionRow = AnalyticsReport["longestObservedActions"][number];
type GroupRow = AnalyticsReport["remotePlatformStatistics"][number];

const duration = (milliseconds: number | null | undefined) =>
  milliseconds === null || milliseconds === undefined
    ? "-"
    : readableDurationFromMilliseconds(milliseconds, { smallestUnit: "ms" });

const percentage = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

const sampledDuration = (sampleCount: number, milliseconds: number) =>
  sampleCount === 0 ? "-" : duration(milliseconds);

const platformName = (action: ActionRow) =>
  action.platform.length === 0
    ? "-"
    : action.platform
        .map(({ name, value }) => [name, value].join("="))
        .join(", ");

const actionColumns: TableColumnsType<ActionRow> = [
  {
    key: "label",
    title: "Action",
    render: (_, action) => (
      <Space direction="vertical" size={0}>
        <Typography.Text copyable={{ text: action.label }}>
          {action.label}
        </Typography.Text>
        <Typography.Text type="secondary">
          {action.mnemonic || "Unknown mnemonic"}
        </Typography.Text>
      </Space>
    ),
  },
  {
    dataIndex: "runner",
    key: "runner",
    title: "Runner",
    render: (runner: string) => runner || "-",
    width: 140,
  },
  {
    dataIndex: "queueTimeInMs",
    key: "queueTimeInMs",
    title: "Queue",
    render: duration,
    width: 110,
  },
  {
    dataIndex: "executionWallTimeInMs",
    key: "executionWallTimeInMs",
    title: "Execution",
    render: duration,
    width: 110,
  },
  {
    key: "inputs",
    title: "Inputs",
    render: (_, action) => {
      if (
        action.inputFiles == null &&
        action.inputBytes == null &&
        action.memoryEstimateBytes == null
      )
        return "-";
      return [
        action.inputFiles == null
          ? undefined
          : `${String(action.inputFiles)} files`,
        action.inputBytes == null
          ? undefined
          : readableFileSize(action.inputBytes),
        action.memoryEstimateBytes == null
          ? undefined
          : `${readableFileSize(action.memoryEstimateBytes)} memory estimate`,
      ]
        .filter(Boolean)
        .join(" / ");
    },
    width: 150,
  },
  {
    key: "platform",
    title: "Execution platform",
    render: (_, action) => platformName(action),
    ellipsis: true,
  },
];

const observedActionColumns: TableColumnsType<ObservedActionRow> = [
  {
    key: "label",
    title: "Action",
    render: (_, action) => (
      <Space direction="vertical" size={0}>
        <Typography.Text copyable={{ text: action.label }}>
          {action.label}
        </Typography.Text>
        <Typography.Text type="secondary">
          {action.mnemonic || "Unknown mnemonic"}
        </Typography.Text>
      </Space>
    ),
  },
  {
    dataIndex: "runner",
    key: "runner",
    title: "Runner",
    render: (runner: string) => runner || "-",
    width: 140,
  },
  {
    dataIndex: "observedDurationInMs",
    key: "observedDurationInMs",
    title: "Observed interval",
    render: duration,
    width: 150,
  },
];

const groupColumns: TableColumnsType<GroupRow> = [
  {
    dataIndex: "name",
    key: "name",
    title: "Group",
    ellipsis: true,
  },
  {
    dataIndex: "actionCount",
    key: "actionCount",
    title: "Actions",
    width: 90,
  },
  {
    key: "totalQueue",
    title: "Total queue",
    render: (_, group) =>
      sampledDuration(group.queueTime.sampleCount, group.queueTime.totalInMs),
    width: 120,
  },
  {
    key: "p50Queue",
    title: "Queue p50",
    render: (_, group) =>
      sampledDuration(group.queueTime.sampleCount, group.queueTime.p50InMs),
    width: 110,
  },
  {
    key: "p95Queue",
    title: "Queue p95",
    render: (_, group) =>
      sampledDuration(group.queueTime.sampleCount, group.queueTime.p95InMs),
    width: 110,
  },
  {
    key: "maximumQueue",
    title: "Queue max",
    render: (_, group) =>
      sampledDuration(group.queueTime.sampleCount, group.queueTime.maximumInMs),
    width: 110,
  },
  {
    key: "p95Execution",
    title: "Execution p95",
    render: (_, group) =>
      sampledDuration(
        group.executionWallTime.sampleCount,
        group.executionWallTime.p95InMs,
      ),
    width: 130,
  },
];

const NotComputedDescription: React.FC<{ failureMessage?: string | null }> = ({
  failureMessage,
}) => (
  <div>
    <Typography.Paragraph>
      The published BEP action timestamps still provide observed-duration and
      overlap statistics. The following execution-log statistics were not
      computed:
    </Typography.Paragraph>
    <ul>
      <li>Remote queue-time percentiles and long-wait outliers</li>
      <li>Subprocess execution time and spawn-phase breakdowns</li>
      <li>Execution-platform and mnemonic contention comparisons</li>
      <li>Input size, input-file count, and memory estimates</li>
    </ul>
    {failureMessage ? (
      <Typography.Paragraph type="secondary">
        Processing error: {failureMessage}
      </Typography.Paragraph>
    ) : (
      <Typography.Paragraph type="secondary">
        To make these statistics available, run Bazel with{" "}
        <Typography.Text code>
          --execution_log_compact_file=&lt;path&gt;
        </Typography.Text>{" "}
        and configure the BES upload so the compact execution log is forwarded.
      </Typography.Paragraph>
    )}
  </div>
);

const AnalyticsStatus: React.FC<Props> = ({ analytics, bepCompleted }) => {
  switch (analytics.state) {
    case ActionAnalyticsState.Pending:
      return (
        <Alert
          showIcon
          icon={<ClockCircleOutlined />}
          type="info"
          message={
            bepCompleted
              ? "Action analytics are queued"
              : "Action analytics will start after the invocation is complete"
          }
          description={
            bepCompleted
              ? "A background processor will claim this invocation shortly."
              : "bb-portal waits until all BEP events have been ingested before computing the report."
          }
        />
      );
    case ActionAnalyticsState.Processing:
      return (
        <Alert
          showIcon
          icon={<LoadingOutlined spin />}
          type="info"
          message="Computing action analytics"
          description="The invocation is complete and its action timing report is being generated asynchronously."
        />
      );
    case ActionAnalyticsState.Failed:
      return (
        <Alert
          showIcon
          type="error"
          message="Action analytics failed"
          description={
            analytics.failureMessage ||
            "The background processor did not provide an error message."
          }
        />
      );
    case ActionAnalyticsState.Completed:
      return null;
  }
};

const ExecutionLogNotice: React.FC<Props> = ({ analytics }) => {
  switch (analytics.executionLogStatus) {
    case ExecutionLogStatus.NotProvided:
      return (
        <Alert
          showIcon
          icon={<WarningOutlined />}
          type="warning"
          message="Execution-log statistics were not computed"
          description={<NotComputedDescription />}
        />
      );
    case ExecutionLogStatus.Failed:
      return (
        <Alert
          showIcon
          type="warning"
          message="Execution-log statistics could not be computed"
          description={
            <NotComputedDescription
              failureMessage={analytics.executionLogFailureMessage}
            />
          }
        />
      );
    case ExecutionLogStatus.Processed:
      if (
        analytics.executionLogMatchedActions < analytics.executionLogActionCount
      ) {
        return (
          <Alert
            showIcon
            icon={<WarningOutlined />}
            type="warning"
            message="Compact execution log was only partially correlated"
            description={`${String(
              analytics.executionLogMatchedActions,
            )} of ${String(
              analytics.executionLogActionCount,
            )} published actions with primary outputs were matched. Unmatched actions were excluded from execution-log-derived statistics.`}
          />
        );
      }
      return (
        <Alert
          showIcon
          icon={<CheckCircleOutlined />}
          type="success"
          message="Compact execution log processed"
          description={[
            analytics.executionLogMatchedActions,
            " of ",
            analytics.executionLogActionCount,
            " published actions with primary outputs were correlated with the compact execution log.",
          ].join("")}
        />
      );
  }
};

const SummaryStatistic: React.FC<{
  title: React.ReactNode;
  value: number | string;
}> = ({ title, value }) => (
  <Col xs={12} md={8} xl={4}>
    <Statistic title={title} value={value} />
  </Col>
);

const BepAnalytics: React.FC<{ report: AnalyticsReport }> = ({ report }) => (
  <Card title="BEP-observed action activity" size="small">
    <Space direction="vertical" size="large" style={{ display: "flex" }}>
      <Alert
        showIcon
        type="info"
        message="These measurements come from ActionExecuted BEP timestamps"
        description="Overlapping action intervals show the shape of action activity and help identify slow observed actions. They are not direct scheduler queue or worker-occupancy measurements, and include every published runner type."
      />
      <Row gutter={[24, 16]}>
        <SummaryStatistic
          title="Published actions"
          value={report.totalActions}
        />
        <SummaryStatistic title="Timed actions" value={report.timedActions} />
        <SummaryStatistic
          title="Peak overlapping intervals"
          value={report.peakConcurrentActions}
        />
        <SummaryStatistic
          title="Average overlapping intervals"
          value={report.averageConcurrency.toFixed(2)}
        />
        <SummaryStatistic
          title="Observed duration p95"
          value={duration(report.observedActionDuration.p95InMs)}
        />
        <SummaryStatistic
          title="Longest observed action"
          value={duration(report.observedActionDuration.maximumInMs)}
        />
      </Row>
      {report.concurrency.length > 0 ? (
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <AreaChart
              data={report.concurrency}
              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id="action-concurrency"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="5%" stopColor="#1677ff" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#1677ff" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="elapsedTimeInMs"
                tickFormatter={(value: number) => duration(value)}
              />
              <YAxis allowDecimals={false} />
              <ChartTooltip
                labelFormatter={(value) =>
                  `Elapsed: ${duration(Number(value))}`
                }
              />
              <Area
                dataKey="concurrentActions"
                name="Overlapping action intervals"
                type="stepAfter"
                stroke="#1677ff"
                fill="url(#action-concurrency)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Alert
          type="info"
          message="No action-overlap timeline was available in BEP."
        />
      )}
      <Table
        columns={observedActionColumns}
        dataSource={report.longestObservedActions}
        locale={{ emptyText: "No timed action intervals were published." }}
        pagination={false}
        rowKey="actionExecutionID"
        scroll={{ x: 650 }}
        size="small"
        title={() => "Longest BEP-observed action intervals"}
      />
    </Space>
  </Card>
);

const ContentionAnalytics: React.FC<{ report: AnalyticsReport }> = ({
  report,
}) => {
  if (report.spawnMetricsActions === 0) {
    return (
      <Alert
        showIcon
        type="warning"
        message="No matched SpawnMetrics were available"
        description="The compact execution log was processed, but its entries did not provide timing metrics that could be correlated with published actions. Queue and execution statistics were not computed."
      />
    );
  }

  const phaseData = report.phaseStatistics.map(({ name, statistics }) => ({
    name,
    totalInMs: statistics.totalInMs,
  }));
  const incompleteRemoteMetrics =
    report.remoteExecutionActions > 0 &&
    (report.remoteQueueTime.sampleCount < report.remoteExecutionActions ||
      report.remoteExecutionWallTime.sampleCount <
        report.remoteExecutionActions);

  return (
    <>
      <Card title="Remote worker contention indicators" size="small">
        <Space direction="vertical" size="large" style={{ display: "flex" }}>
          <Alert
            showIcon
            type="info"
            message="Queue time is a contention signal, not proof that workers were missing"
            description="Long remote queue waits may indicate insufficient eligible worker capacity, but priority, fairness, execution-platform constraints, and size-class routing can produce the same pattern. Compare the platform groups and individual outliers below."
          />
          {report.remoteExecutionActions === 0 && (
            <Alert
              showIcon
              type="warning"
              message="Remote contention statistics were not computed"
              description="No non-cached remote executions with correlated compact-log entries were available for this invocation."
            />
          )}
          {incompleteRemoteMetrics && (
            <Alert
              showIcon
              type="warning"
              message="Some remote execution-log statistics were not computed"
              description={`${String(
                report.remoteQueueTime.sampleCount,
              )} queue measurements and ${String(
                report.remoteExecutionWallTime.sampleCount,
              )} subprocess execution measurements were available for ${String(
                report.remoteExecutionActions,
              )} non-cached remote executions.`}
            />
          )}
          <Row gutter={[24, 16]}>
            <SummaryStatistic
              title="Remote executions"
              value={report.remoteExecutionActions}
            />
            <SummaryStatistic
              title="Queue measurements"
              value={`${String(report.remoteQueueTime.sampleCount)} / ${String(
                report.remoteExecutionActions,
              )}`}
            />
            <SummaryStatistic
              title="Total remote queue"
              value={sampledDuration(
                report.remoteQueueTime.sampleCount,
                report.remoteQueueTime.totalInMs,
              )}
            />
            <SummaryStatistic
              title="Remote queue p50"
              value={sampledDuration(
                report.remoteQueueTime.sampleCount,
                report.remoteQueueTime.p50InMs,
              )}
            />
            <SummaryStatistic
              title="Remote queue p95"
              value={sampledDuration(
                report.remoteQueueTime.sampleCount,
                report.remoteQueueTime.p95InMs,
              )}
            />
            <SummaryStatistic
              title="Longest remote queue"
              value={sampledDuration(
                report.remoteQueueTime.sampleCount,
                report.remoteQueueTime.maximumInMs,
              )}
            />
            <SummaryStatistic
              title="Remote execution p95"
              value={sampledDuration(
                report.remoteExecutionWallTime.sampleCount,
                report.remoteExecutionWallTime.p95InMs,
              )}
            />
            <SummaryStatistic
              title={
                <Tooltip title="Total remote queue time divided by total remote subprocess execution time. A value of 100% means the invocation accumulated as much queue time as execution time.">
                  <span>Queue / execution</span>
                </Tooltip>
              }
              value={
                report.remoteQueueTime.sampleCount === 0 ||
                report.remoteExecutionWallTime.sampleCount === 0
                  ? "-"
                  : percentage(report.queueToExecutionRatio)
              }
            />
          </Row>
        </Space>
      </Card>

      {phaseData.length > 0 && (
        <Card title="Accumulated SpawnMetrics time by phase" size="small">
          <Space direction="vertical" style={{ display: "flex" }}>
            <Typography.Text type="secondary">
              This breakdown includes every action whose compact execution-log
              entry was matched, including local and remote runners. Remote-only
              queue analysis is shown separately.
            </Typography.Text>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <BarChart
                  data={phaseData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 30, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(value: number) => duration(value)}
                  />
                  <YAxis dataKey="name" type="category" width={100} />
                  <ChartTooltip
                    formatter={(value) => duration(Number(value))}
                  />
                  <Bar
                    dataKey="totalInMs"
                    name="Accumulated time"
                    fill="#1677ff"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Space>
        </Card>
      )}

      <Card title="Longest remote queue waits" size="small">
        <Table
          columns={actionColumns}
          dataSource={report.longestQueueWaits}
          locale={{ emptyText: "No remote queue measurements were reported." }}
          pagination={false}
          rowKey="actionExecutionID"
          scroll={{ x: 900 }}
          size="small"
        />
      </Card>

      <Card title="Slowest subprocess executions" size="small">
        <Table
          columns={actionColumns}
          dataSource={report.slowestExecutions}
          locale={{
            emptyText: "No subprocess execution measurements were reported.",
          }}
          pagination={false}
          rowKey="actionExecutionID"
          scroll={{ x: 900 }}
          size="small"
        />
      </Card>

      <Card title="Remote execution platforms" size="small">
        <Table
          columns={groupColumns}
          dataSource={report.remotePlatformStatistics}
          locale={{ emptyText: "No remote execution platforms were reported." }}
          pagination={false}
          rowKey="name"
          scroll={{ x: 850 }}
          size="small"
        />
      </Card>

      <Card title="Remote action mnemonics" size="small">
        <Table
          columns={groupColumns}
          dataSource={report.remoteMnemonicStatistics}
          locale={{ emptyText: "No remote action mnemonics were reported." }}
          pagination={false}
          rowKey="name"
          scroll={{ x: 850 }}
          size="small"
        />
      </Card>
    </>
  );
};

export const ActionAnalyticsTab: React.FC<Props> = ({
  analytics,
  bepCompleted,
}) => {
  if (analytics.state !== ActionAnalyticsState.Completed) {
    return (
      <div style={{ marginTop: 16 }}>
        <AnalyticsStatus analytics={analytics} bepCompleted={bepCompleted} />
      </div>
    );
  }

  if (!analytics.report) {
    return (
      <div style={{ marginTop: 16 }}>
        <Alert
          showIcon
          type="error"
          message="The analytics job completed without a report"
        />
      </div>
    );
  }

  return (
    <Flex vertical gap="middle" style={{ marginTop: 16 }}>
      <Flex align="center" gap="small">
        <Tag color="success" icon={<CheckCircleOutlined />}>
          Analytics complete
        </Tag>
        {analytics.completedAt && (
          <Typography.Text type="secondary">
            {new Date(analytics.completedAt).toLocaleString()}
          </Typography.Text>
        )}
      </Flex>
      <ExecutionLogNotice analytics={analytics} bepCompleted={bepCompleted} />
      <BepAnalytics report={analytics.report} />
      {analytics.executionLogStatus === ExecutionLogStatus.Processed && (
        <ContentionAnalytics report={analytics.report} />
      )}
    </Flex>
  );
};
