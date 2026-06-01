import {
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ExperimentOutlined,
  LinkOutlined,
  FileSearchOutlined,
  FolderOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons";
import { Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { Alert, List, Menu, Space, Typography } from "antd";
import dayjs from "@/lib/dayjs";
import type React from "react";
import { ActionsTab } from "@/components/ActionsTab";
import NullBooleanTag from "@/components/NullableBooleanTag";
import { InvocationTargetTagList } from "@/components/InvocationTargets/InvocationTargetTagList";
import PortalCard from "@/components/PortalCard";
import PortalDuration from "@/components/PortalDuration";
import { CasViewer } from "@/components/LogViewer/casViewer";
import { InvocationTargetAbortReasonTag } from "@/components/InvocationTargetAbortReasonTag";
import {
  BazelInvocationTestRunsPanel,
  BazelInvocationTestSummaryPanel,
} from "@/components/pages/BazelInvocationTestDetails";
import type {
  BazelInvocationActionsFragment,
  InvocationTargetAbortReason,
} from "@/graphql/__generated__/graphql";
import { digestFunctionValueToString } from "@/utils/digestFunctionUtils";
import { parseBytestreamUri } from "@/utils/bytestreamUri";
import { generateFileUrl } from "@/utils/urlGenerator";
import styles from "./index.module.css";

interface InvocationTargetDetails {
  id: string;
  success: boolean;
  abortReason: InvocationTargetAbortReason;
  durationInMs?: number | null;
  failureMessage?: string | null;
  tags?: string[] | null;
  startTimeInMs?: number | null;
  endTimeInMs?: number | null;
  target: {
    id: string;
    label: string;
    aspect: string;
    targetKind: string;
    instanceName: {
      name: string;
    };
  };
  targetFiles?: Array<{
    name: string;
    uri?: string | null;
  }> | null;
  testSummary?: Array<any> | null;
}

interface Props {
  invocationID: string;
  target: InvocationTargetDetails;
  actions?: BazelInvocationActionsFragment[] | null;
}

const renderFileLink = (file: { name: string; uri?: string | null }) => {
  if (!file.uri) {
    return (
      <Typography.Text type="secondary" key={file.name}>
        {file.name}
      </Typography.Text>
    );
  }

  const parsed = parseBytestreamUri(file.uri);
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
      href={generateFileUrl(
        parsed.instanceName,
        parsed.digestFunction,
        parsed.digest,
        file.name,
      )}
      download={file.name}
      target="_self"
      rel="noreferrer"
    >
      {file.name}
    </a>
  );
};

const renderTags = (tags: string[] | null | undefined) => {
  if (!tags || tags.length === 0) {
    return "-";
  }
  return <InvocationTargetTagList tags={tags} />;
};

const formatTime = (value?: number | string | null) =>
  typeof value === "number" || typeof value === "string"
    ? dayjs(value).format("YYYY-MM-DD HH:mm:ss")
    : "-";

const getTestLogFile = (
  files?: Array<{ name: string; uri?: string | null }> | null,
) => {
  if (!Array.isArray(files)) {
    return undefined;
  }
  return files.find((file) => file.name === "test.log");
};

const renderFileList = (files: Array<{ name: string; uri?: string | null }>) => (
  <List
    size="small"
    dataSource={[...files].sort((left, right) => left.name.localeCompare(right.name))}
    renderItem={(file) => <List.Item className={styles.fileRow}>{renderFileLink(file)}</List.Item>}
  />
);

export const BazelInvocationTargetOverviewPanel: React.FC<{
  invocationID: string;
  target: InvocationTargetDetails;
}> = ({ invocationID, target }) => {
  const buildDurationTo =
    typeof target.startTimeInMs === "number" &&
    typeof target.durationInMs === "number"
      ? dayjs(target.startTimeInMs)
          .add(target.durationInMs, "millisecond")
          .toISOString()
      : undefined;
  const testSummary = target.testSummary?.[0];

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div className={styles.detailGrid}>
        <div className={styles.detailItem}>
          <div className={styles.detailLabel}>Abort Reason</div>
          <div className={styles.detailValue}>
            <InvocationTargetAbortReasonTag reason={target.abortReason} />
          </div>
        </div>
        <div className={styles.detailItem}>
          <div className={styles.detailLabel}>Target Kind</div>
          <div className={styles.detailValue}>{target.target.targetKind}</div>
        </div>
        <div className={styles.detailItem}>
          <div className={styles.detailLabel}>Aspect</div>
          <div className={styles.detailValue}>{target.target.aspect || "-"}</div>
        </div>
        <div className={styles.detailItem}>
          <div className={styles.detailLabel}>Instance Name</div>
          <div className={styles.detailValue}>
            {target.target.instanceName.name}
          </div>
        </div>
        <div className={styles.detailItem}>
          <div className={styles.detailLabel}>Tags</div>
          <div className={styles.detailValue}>{renderTags(target.tags)}</div>
        </div>
        <div className={styles.detailItem}>
          <div className={styles.detailLabel}>Invocation ID</div>
          <div className={styles.detailValue}>
            <Link to="/bazel-invocations/$invocationID" params={{ invocationID }}>
              {invocationID}
            </Link>
          </div>
        </div>
        <div className={styles.detailItem}>
          <div className={styles.detailLabel}>Started</div>
          <div className={styles.detailValue}>
            {formatTime(target.startTimeInMs)}
          </div>
        </div>
        <div className={styles.detailItem}>
          <div className={styles.detailLabel}>Finished</div>
          <div className={styles.detailValue}>
            {formatTime(target.endTimeInMs)}
          </div>
        </div>
        <div className={styles.detailItem}>
          <div className={styles.detailLabel}>Build Duration</div>
          <div className={styles.detailValue}>
            <PortalDuration
              from={
                typeof target.startTimeInMs === "number"
                  ? dayjs(target.startTimeInMs).toISOString()
                  : undefined
              }
              to={buildDurationTo}
              includeIcon
              formatConfig={{ smallestUnit: "ms" }}
            />
          </div>
        </div>
        {testSummary && (
          <div className={styles.detailItem}>
            <div className={styles.detailLabel}>Total Test Duration</div>
            <div className={styles.detailValue}>
              <PortalDuration
                from={testSummary.firstStartTime}
                to={
                  testSummary.firstStartTime && testSummary.totalRunDurationInMs
                    ? dayjs(testSummary.firstStartTime)
                        .add(testSummary.totalRunDurationInMs, "millisecond")
                        .toISOString()
                    : undefined
                }
                includeIcon
                formatConfig={{ smallestUnit: "ms" }}
              />
            </div>
          </div>
        )}
      </div>
      {target.failureMessage && (
        <Alert
          showIcon
          type="error"
          message="Failure message"
          description={
            <pre className={styles.failureMessage}>{target.failureMessage}</pre>
          }
        />
      )}
    </Space>
  );
};

export const BazelInvocationTargetTestSummaryPanel: React.FC<{
  summary: any;
}> = ({ summary }) => (
  <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <Link
        to="/tests/$targetID"
        params={{ targetID: summary.invocationTarget.target.id }}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <LinkOutlined />
        Open Tests Page
      </Link>
    </div>
    <BazelInvocationTestSummaryPanel summary={summary} />
    <BazelInvocationTestRunsPanel summary={summary} />
  </Space>
);

export const BazelInvocationTargetLogsPanel: React.FC<{
  instanceName: string;
  target: InvocationTargetDetails;
}> = ({ instanceName, target }) => {
  const testLogFile = getTestLogFile(target.targetFiles);
  const testLogParsed =
    testLogFile && testLogFile.uri ? parseBytestreamUri(testLogFile.uri) : undefined;

  if (!testLogFile) {
    return (
      <Alert
        showIcon
        type="warning"
        message="No remote log file is available for this target."
      />
    );
  }

  return testLogFile.uri && testLogParsed ? (
    <CasViewer
      instanceName={testLogParsed.instanceName || instanceName}
      digestFunction={digestFunctionValueToString(testLogParsed.digestFunction)}
      digest={testLogParsed.digest.hash}
      sizeBytes={Number(testLogParsed.digest.sizeBytes)}
      title="Target Log"
      fileName={testLogFile.name}
    />
  ) : (
    <Alert
      showIcon
      type="warning"
      message="The log file is not stored in a remote-retrievable format."
      description={
        testLogFile.uri ? (
          <Typography.Text>
            The log file is not stored in a remote-retrievable format.
          </Typography.Text>
        ) : undefined
      }
    />
  );
};

export const BazelInvocationTargetActionsPanel: React.FC<{
  instanceName: string;
  actions: BazelInvocationActionsFragment[];
  targetLabel: string;
}> = ({ instanceName, actions, targetLabel }) => {
  const targetActions = actions.filter((action) => action.label === targetLabel);
  if (targetActions.length === 0) {
    return <Alert type="info" showIcon message="No actions were recorded." />;
  }
  return <ActionsTab instanceName={instanceName} actions={targetActions} />;
};

export const BazelInvocationTargetFilesPanel: React.FC<{
  files?: Array<{
    name: string;
    uri?: string | null;
  }> | null;
}> = ({ files }) => {
  if (!Array.isArray(files) || files.length === 0) {
    return <Alert type="info" showIcon message="No remote files were recorded." />;
  }
  return renderFileList(files);
};

export const BazelInvocationTargetDetailsPage: React.FC<Props> = ({
  invocationID,
  target,
  actions,
}) => {
  const matchRoute = useMatchRoute();
  const start =
    typeof target.startTimeInMs === "number"
      ? new Date(target.startTimeInMs).toISOString()
      : undefined;
  const end =
    typeof target.endTimeInMs === "number"
      ? new Date(target.endTimeInMs).toISOString()
      : undefined;
  const menuItems = [
    {
      key: "overview",
      icon: <InfoCircleOutlined />,
      label: <Link to="/bazel-invocations/$invocationID/targets/$targetID" params={{ invocationID, targetID: target.target.id }}>Overview</Link>,
    },
    ...(target.targetFiles?.some((file) => file.name === "test.log" && file.uri)
      ? [
          {
            key: "logs",
            icon: <FileSearchOutlined />,
            label: <Link to="/bazel-invocations/$invocationID/targets/$targetID/logs" params={{ invocationID, targetID: target.target.id }}>Logs</Link>,
          },
        ]
      : []),
    ...(actions?.some((action) => action.label === target.target.label)
      ? [
          {
            key: "actions",
            icon: <DatabaseOutlined />,
            label: <Link to="/bazel-invocations/$invocationID/targets/$targetID/actions" params={{ invocationID, targetID: target.target.id }}>Actions</Link>,
          },
        ]
      : []),
    ...(target.testSummary?.length
      ? [
          {
            key: "test-summary",
            icon: <ExperimentOutlined />,
            label: <Link to="/bazel-invocations/$invocationID/targets/$targetID/test-summary" params={{ invocationID, targetID: target.target.id }}>Test Summary</Link>,
          },
        ]
      : []),
    ...(Array.isArray(target.targetFiles) && target.targetFiles.length > 0
      ? [
          {
            key: "files",
            icon: <FolderOutlined />,
            label: <Link to="/bazel-invocations/$invocationID/targets/$targetID/files" params={{ invocationID, targetID: target.target.id }}>Files</Link>,
          },
        ]
      : []),
  ];
  const selectedKey = matchRoute({
    to: "/bazel-invocations/$invocationID/targets/$targetID/test-summary",
    params: { invocationID, targetID: target.target.id },
  })
    ? "test-summary"
    : matchRoute({
          to: "/bazel-invocations/$invocationID/targets/$targetID/logs",
          params: { invocationID, targetID: target.target.id },
        })
      ? "logs"
      : matchRoute({
            to: "/bazel-invocations/$invocationID/targets/$targetID/actions",
            params: { invocationID, targetID: target.target.id },
          })
        ? "actions"
        : matchRoute({
              to: "/bazel-invocations/$invocationID/targets/$targetID/files",
              params: { invocationID, targetID: target.target.id },
            })
          ? "files"
          : "overview";

  return (
    <PortalCard
      icon={<DeploymentUnitOutlined />}
      titleBits={[
        <span key="title">
          Target:{" "}
          <Link to="/targets/$targetID" params={{ targetID: target.target.id }}>
            <Typography.Text
              type="secondary"
              copyable={{ text: target.target.label }}
            >
              {target.target.label}
            </Typography.Text>
          </Link>
        </span>,
        <span key="status">
          Status:{" "}
          <Typography.Text type="secondary" className={styles.normalWeight}>
            <NullBooleanTag status={target.success} />
          </Typography.Text>
        </span>,
      ]}
      extraBits={[
        <PortalDuration
          key="duration"
          from={start}
          to={end}
          includeIcon
          formatConfig={{ smallestUnit: "ms" }}
        />,
      ]}
    >
      <Menu
        mode="horizontal"
        style={{ background: "inherit" }}
        selectedKeys={[selectedKey]}
        items={menuItems}
      />
      <Outlet />
    </PortalCard>
  );
};
