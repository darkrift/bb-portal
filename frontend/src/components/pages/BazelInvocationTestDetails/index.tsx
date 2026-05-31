import {
  FileSearchOutlined,
  OrderedListOutlined,
} from "@ant-design/icons";
import { Link } from "@tanstack/react-router";
import { Alert, List, Space, Tabs, Typography } from "antd";
import dayjs from "@/lib/dayjs";
import type React from "react";
import NullBooleanTag from "@/components/NullableBooleanTag";
import PortalCard from "@/components/PortalCard";
import PortalDuration from "@/components/PortalDuration";
import SummaryPieChart, {
  type SummaryChartItem,
} from "@/components/SummaryPieChart";
import { CasViewer } from "@/components/LogViewer/casViewer";
import TestStatusTag, { type TestStatusEnum } from "@/components/TestStatusTag";
import { digestFunctionValueToString } from "@/utils/digestFunctionUtils";
import { parseBytestreamUri } from "@/utils/bytestreamUri";
import { nullPercent } from "@/components/Utilities/nullPercent";
import { readableDuration, readableDurationFromMilliseconds } from "@/utils/time";
import { generateFileUrl } from "@/utils/urlGenerator";
import styles from "./index.module.css";

interface Props {
  summary: any;
}

type TimingNode = {
  Name?: string;
  name?: string;
  DurationMillis?: number;
  durationMillis?: number;
  Children?: TimingNode[];
  children?: TimingNode[];
  child?: TimingNode[];
  time?: string;
};

const phaseColors = [
  "#1677ff",
  "#52c41a",
  "#fa8c16",
  "#f5222d",
  "#13c2c2",
  "#722ed1",
  "#eb2f96",
  "#2f54eb",
];

const formatDuration = (durationInMs: number | null | undefined) => {
  if (durationInMs === null || durationInMs === undefined) {
    return "-";
  }
  return readableDurationFromMilliseconds(durationInMs, {
    smallestUnit: "ms",
  });
};

const getTimingName = (node: TimingNode) =>
  node.Name || node.name || "Unnamed phase";

const getTimingDuration = (node: TimingNode) => {
  if (typeof node.DurationMillis === "number") {
    return node.DurationMillis;
  }
  if (typeof node.durationMillis === "number") {
    return node.durationMillis;
  }
  if (typeof node.time === "string" && node.time.length > 0) {
    const match = node.time.match(/([0-9.]+)(ms|s|m|h)$/);
    if (match) {
      const value = Number.parseFloat(match[1]);
      const unit = match[2];
      if (!Number.isNaN(value)) {
        switch (unit) {
          case "ms":
            return value;
          case "s":
            return value * 1000;
          case "m":
            return value * 60_000;
          case "h":
            return value * 3_600_000;
        }
      }
    }
  }
  return 0;
};

const getTimingChildren = (node: TimingNode): TimingNode[] => {
  if (Array.isArray(node.Children)) {
    return node.Children;
  }
  if (Array.isArray(node.children)) {
    return node.children;
  }
  if (Array.isArray(node.child)) {
    return node.child;
  }
  return [];
};

const buildPhaseItems = (root: TimingNode): SummaryChartItem[] => {
  const children = getTimingChildren(root);
  const totalDuration = getTimingDuration(root);

  return children.map((child, index) => {
    const duration = getTimingDuration(child);
    return {
      key: `${getTimingName(child)}-${index}`,
      value: getTimingName(child),
      percent: nullPercent(duration, totalDuration, 1),
      count: duration,
      countLabel: readableDuration(dayjs.duration(duration, "milliseconds")),
      fill: phaseColors[index % phaseColors.length],
    };
  });
};

const parseTestResultFile = (file: { name: string; uri: string }) => {
  const parsed = parseBytestreamUri(file.uri);
  if (!parsed) {
    return undefined;
  }
  return {
    ...parsed,
    downloadUrl: generateFileUrl(
      parsed.instanceName,
      parsed.digestFunction,
      parsed.digest,
      file.name,
    ),
  };
};

const renderFileLink = (file: { name: string; uri: string }) => {
  const parsed = parseTestResultFile(file);
  if (!parsed) {
    return (
      <Typography.Text type="secondary" key={file.name}>
        {file.name}
      </Typography.Text>
    );
  }

  return (
    <a
      key={file.name}
      href={parsed.downloadUrl}
      download={file.name}
      target="_self"
      rel="noreferrer"
    >
      {file.name}
    </a>
  );
};

const renderOverview = (testResult: any) => {
  const fields: Array<[string, React.ReactNode]> = [
    ["Cached locally", <NullBooleanTag key="local" status={testResult.cachedLocally} />],
    [
      "Cached remotely",
      <NullBooleanTag key="remote" status={testResult.cachedRemotely} />,
    ],
    ["Strategy", testResult.strategy || "-"],
    ["Hostname", testResult.hostname || "-"],
    ["Exit code", testResult.exitCode ?? "-"],
    ["Status details", testResult.statusDetails || "-"],
    [
      "Started",
      testResult.testAttemptStart
        ? dayjs(testResult.testAttemptStart).format("YYYY-MM-DD HH:mm:ss")
        : "-",
    ],
    ["Duration", formatDuration(testResult.testAttemptDurationInMs)],
  ];

  return (
    <div className={styles.detailGrid}>
      {fields.map(([label, value]) => (
        <div key={label} className={styles.detailItem}>
          <div className={styles.detailLabel}>{label}</div>
          <div className={styles.detailValue}>{value}</div>
        </div>
      ))}
      {Array.isArray(testResult.warning) && testResult.warning.length > 0 && (
        <div className={styles.warningBlock}>
          <div className={styles.detailLabel}>Warnings</div>
          <ul className={styles.warningList}>
            {testResult.warning.map((warning: string, index: number) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const renderLogs = (summary: any, testResult: any) => {
  const logFile = testResult.testResultFiles?.find(
    (file: { name: string; uri: string }) => file.name === "test.log",
  );

  if (!logFile) {
    return (
      <Alert
        type="warning"
        showIcon
        message="No log file is available for this run."
      />
    );
  }

  const parsed = parseTestResultFile(logFile);
  if (!parsed) {
    return (
      <Alert
        type="warning"
        showIcon
        message="The log file is not stored in a remote-retrievable format."
      />
    );
  }

  return (
    <CasViewer
      instanceName={parsed.instanceName || summary.invocationTarget.target.instanceName.name}
      digestFunction={digestFunctionValueToString(parsed.digestFunction)}
      digest={parsed.digest.hash}
      sizeBytes={Number(parsed.digest.sizeBytes)}
      title="Run Log"
      fileName={logFile.name}
    />
  );
};

const renderFiles = (testResult: any) => {
  const files = [...(testResult.testResultFiles || [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  if (files.length === 0) {
    return (
      <Alert type="info" showIcon message="No remote files were recorded." />
    );
  }

  return (
    <List
      size="small"
      dataSource={files}
      renderItem={(file: { name: string; uri: string }) => (
        <List.Item className={styles.fileRow}>{renderFileLink(file)}</List.Item>
      )}
    />
  );
};

const renderPhases = (testResult: any) => {
  const root = testResult.timingBreakdown as TimingNode | undefined;
  if (!root) {
    return <Alert type="info" showIcon message="No phase breakdown is available." />;
  }

  const phaseItems = buildPhaseItems(root);
  if (phaseItems.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        message="No phase breakdown is available."
      />
    );
  }

  return (
    <Space direction="vertical" size="middle" className={styles.phaseSection}>
      <div className={styles.phaseHeader}>
        <Typography.Text strong>Phase Breakdown</Typography.Text>
        <Typography.Text type="secondary">
          Total time: {formatDuration(getTimingDuration(root))}
        </Typography.Text>
      </div>
      <SummaryPieChart items={phaseItems} chartWidth={700} />
    </Space>
  );
};

const getRunTitleBits = (testResult: any): React.ReactNode[] => [
  <span key="run">
    Run:{" "}
    <Typography.Text className={styles.normalWeight}>
      {testResult.run}
    </Typography.Text>
  </span>,
  <span key="shard">
    Shard:{" "}
    <Typography.Text className={styles.normalWeight}>
      {testResult.shard}
    </Typography.Text>
  </span>,
  <span key="attempt">
    Attempt:{" "}
    <Typography.Text className={styles.normalWeight}>
      {testResult.attempt}
    </Typography.Text>
  </span>,
  <span key="status">
    Status:{" "}
    <Typography.Text className={styles.normalWeight}>
      <TestStatusTag
        displayText
        status={testResult.status as TestStatusEnum}
      />
    </Typography.Text>
  </span>,
];

const getRunExtraBits = (testResult: any) => {
  const from = testResult.testAttemptStart;
  const duration = testResult.testAttemptDurationInMs || 0;
  if (!from || !duration) {
    return [];
  }
  return [
    <PortalDuration
      key="duration"
      from={from}
      to={dayjs(from).add(duration, "millisecond").toISOString()}
      includeIcon
      formatConfig={{ smallestUnit: "ms" }}
    />,
  ];
};

const getSummaryTitleBits = (summary: any): React.ReactNode[] => [
  <span key="target">
    Target:{" "}
    <Typography.Text className={styles.normalWeight}>
      <Link
        to="/targets/$targetID/tests"
        params={{ targetID: summary.invocationTarget.target.id }}
      >
        <Typography.Text
          type="secondary"
          copyable={{ text: summary.invocationTarget.target.label }}
        >
          {summary.invocationTarget.target.label}
        </Typography.Text>
      </Link>
    </Typography.Text>
  </span>,
];

const getSummaryExtraBits = (summary: any) => {
  const from = summary.firstStartTime;
  const duration = summary.totalRunDurationInMs || 0;
  if (!from || !duration) {
    return [];
  }
  return [
    <PortalDuration
      key="duration"
      from={from}
      to={dayjs(from).add(duration, "millisecond").toISOString()}
      includeIcon
      formatConfig={{ smallestUnit: "ms" }}
    />,
  ];
};

export const BazelInvocationTestDetailsPage: React.FC<Props> = ({ summary }) => {
  return (
    <Space direction="vertical" size="middle" className={styles.page}>
      <PortalCard
        icon={<FileSearchOutlined />}
        titleBits={getSummaryTitleBits(summary)}
        extraBits={getSummaryExtraBits(summary)}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <div className={styles.summaryGrid}>
            <div className={styles.detailItem}>
              <div className={styles.summaryLabel}>Status</div>
              <div className={styles.summaryValue}>
                <TestStatusTag
                  displayText
                  status={summary.overallStatus as TestStatusEnum}
                />
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.summaryLabel}>Run count</div>
              <div className={styles.summaryValue}>
                {summary.runCount ?? "-"}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.summaryLabel}>Attempt count</div>
              <div className={styles.summaryValue}>
                {summary.attemptCount ?? "-"}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.summaryLabel}>Shard count</div>
              <div className={styles.summaryValue}>
                {summary.shardCount ?? "-"}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.summaryLabel}>Total cached</div>
              <div className={styles.summaryValue}>
                {summary.totalNumCached ?? "-"}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.summaryLabel}>Instance name</div>
              <div className={styles.summaryValue}>
                {summary.invocationTarget.target.instanceName.name}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.summaryLabel}>Target kind</div>
              <div className={styles.summaryValue}>
                {summary.invocationTarget.target.targetKind}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.summaryLabel}>Target aspect</div>
              <div className={styles.summaryValue}>
                {summary.invocationTarget.target.aspect || "-"}
              </div>
            </div>
          </div>

          {(summary.testResults || [])
            .slice()
            .sort((left: any, right: any) => {
              const runDiff = left.run - right.run;
              if (runDiff !== 0) {
                return runDiff;
              }
              const shardDiff = left.shard - right.shard;
              if (shardDiff !== 0) {
                return shardDiff;
              }
              return left.attempt - right.attempt;
            })
            .map((testResult: any) => (
              <PortalCard
                key={`${testResult.run}-${testResult.shard}-${testResult.attempt}`}
                type="inner"
                icon={<OrderedListOutlined />}
                titleBits={getRunTitleBits(testResult)}
                extraBits={getRunExtraBits(testResult)}
                className={styles.runCard}
              >
                <Tabs
                  items={[
                    {
                      key: "overview",
                      label: "Overview",
                      children: renderOverview(testResult),
                    },
                    {
                      key: "logs",
                      label: "Logs",
                      children: renderLogs(summary, testResult),
                    },
                    {
                      key: "phases",
                      label: "Phases",
                      children: renderPhases(testResult),
                    },
                    {
                      key: "files",
                      label: "Files",
                      children: renderFiles(testResult),
                    },
                  ]}
                />
              </PortalCard>
            ))}
        </Space>
      </PortalCard>
    </Space>
  );
};
