import { DeploymentUnitOutlined, FileSearchOutlined } from "@ant-design/icons";
import { Link } from "@tanstack/react-router";
import { Alert, List, Space, Tabs, Typography, type TabsProps } from "antd";
import dayjs from "@/lib/dayjs";
import type React from "react";
import { ActionsTab } from "@/components/ActionsTab";
import NullBooleanTag from "@/components/NullableBooleanTag";
import { InvocationTargetTagList } from "@/components/InvocationTargets/InvocationTargetTagList";
import PortalCard from "@/components/PortalCard";
import PortalDuration from "@/components/PortalDuration";
import { CasViewer } from "@/components/LogViewer/casViewer";
import { InvocationTargetAbortReasonTag } from "@/components/InvocationTargetAbortReasonTag";
import type {
  BazelInvocationActionsFragment,
  InvocationTargetAbortReason,
} from "@/graphql/__generated__/graphql";
import TestStatusTag, { type TestStatusEnum } from "@/components/TestStatusTag";
import { digestFunctionValueToString } from "@/utils/digestFunctionUtils";
import { parseBytestreamUri } from "@/utils/bytestreamUri";
import { generateFileUrl } from "@/utils/urlGenerator";
import { readableDurationFromMilliseconds } from "@/utils/time";
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
  testSummary?: Array<{
    id: string;
    overallStatus?: string | null;
    runCount?: number | null;
    attemptCount?: number | null;
    shardCount?: number | null;
    totalNumCached?: number | null;
    totalRunDurationInMs?: number | null;
    firstStartTime?: string | null;
    lastStopTime?: string | null;
  }> | null;
}

interface Props {
  invocationID: string;
  instanceName: string;
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

export const BazelInvocationTargetDetailsPage: React.FC<Props> = ({
  invocationID,
  instanceName,
  target,
  actions,
}) => {
  const duration =
    typeof target.durationInMs === "number"
      ? readableDurationFromMilliseconds(target.durationInMs, {
          smallestUnit: "ms",
        })
      : "-";

  const start =
    typeof target.startTimeInMs === "number"
      ? new Date(target.startTimeInMs).toISOString()
      : undefined;
  const end =
    typeof target.endTimeInMs === "number"
      ? new Date(target.endTimeInMs).toISOString()
      : undefined;

  const testSummaryList = target.testSummary ?? [];
  const hasTestSummary = testSummaryList.length > 0;
  const testSummary = hasTestSummary ? testSummaryList[0] : undefined;
  const testSummaryDuration =
    typeof testSummary?.totalRunDurationInMs === "number"
      ? readableDurationFromMilliseconds(testSummary.totalRunDurationInMs, {
          smallestUnit: "ms",
        })
      : "-";
  const testLogFile = getTestLogFile(target.targetFiles);
  const testLogParsed =
    testLogFile && testLogFile.uri ? parseBytestreamUri(testLogFile.uri) : undefined;
  const targetActions =
    actions?.filter((action) => action.label === target.target.label) ?? [];
  const tabItems: NonNullable<TabsProps["items"]> = [
    {
      key: "overview",
      label: "Overview",
      children: (
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
              <div className={styles.detailValue}>
                {target.target.targetKind}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>Aspect</div>
              <div className={styles.detailValue}>
                {target.target.aspect || "-"}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>Tags</div>
              <div className={styles.detailValue}>
                {renderTags(target.tags)}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>Invocation ID</div>
              <div className={styles.detailValue}>
                <Link
                  to="/bazel-invocations/$invocationID"
                  params={{ invocationID }}
                >
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
              <div className={styles.detailLabel}>Duration</div>
              <div className={styles.detailValue}>{duration}</div>
            </div>
          </div>
          {target.failureMessage && (
            <Alert
              showIcon
              type="error"
              message="Failure message"
              description={
                <pre className={styles.failureMessage}>
                  {target.failureMessage}
                </pre>
              }
            />
          )}
        </Space>
      ),
    },
  ];

  if (testSummary) {
    tabItems.push({
      key: "test-summary",
      label: "Test Summary",
      children: (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <div className={styles.detailGrid}>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>Overall Status</div>
              <div className={styles.detailValue}>
                <TestStatusTag
                  status={testSummary.overallStatus as TestStatusEnum | null}
                  displayText
                />
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>Runs</div>
              <div className={styles.detailValue}>
                {testSummary.runCount ?? "-"}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>Attempts</div>
              <div className={styles.detailValue}>
                {testSummary.attemptCount ?? "-"}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>Shards</div>
              <div className={styles.detailValue}>
                {testSummary.shardCount ?? "-"}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>Cached</div>
              <div className={styles.detailValue}>
                {testSummary.totalNumCached ?? "-"}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>Total Duration</div>
              <div className={styles.detailValue}>{testSummaryDuration}</div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>First Start</div>
              <div className={styles.detailValue}>
                {formatTime(testSummary.firstStartTime)}
              </div>
            </div>
            <div className={styles.detailItem}>
              <div className={styles.detailLabel}>Last Stop</div>
              <div className={styles.detailValue}>
                {formatTime(testSummary.lastStopTime)}
              </div>
            </div>
          </div>
          <Space>
            <Link
              to="/bazel-invocations/$invocationID/tests/$targetID"
              params={{
                invocationID,
                targetID: target.target.id,
              }}
            >
              View Test Runs
            </Link>
          </Space>
        </Space>
      ),
    });
  }

  if (testLogFile) {
    tabItems.push({
      key: "logs",
      label: (
        <Space size={4}>
          <FileSearchOutlined />
          <span>Logs</span>
        </Space>
      ),
      children:
        testLogFile.uri && testLogParsed ? (
          <CasViewer
            instanceName={
              testLogParsed.instanceName || target.target.instanceName.name
            }
            digestFunction={digestFunctionValueToString(
              testLogParsed.digestFunction,
            )}
            digest={testLogParsed.digest.hash}
            sizeBytes={Number(testLogParsed.digest.sizeBytes)}
            title="Target Log"
            fileName={testLogFile.name}
          />
        ) : (
          <Alert
            showIcon
            type="warning"
            message="No remote log file is available for this target."
            description={
              testLogFile.uri ? (
                <Typography.Text>
                  The log file is not stored in a remote-retrievable format.
                </Typography.Text>
              ) : undefined
            }
          />
        ),
    });
  }

  if (targetActions.length > 0) {
    tabItems.push({
      key: "actions",
      label: "Actions",
      children: <ActionsTab instanceName={instanceName} actions={targetActions} />,
    });
  }

  if (Array.isArray(target.targetFiles) && target.targetFiles.length > 0) {
    tabItems.push({
      key: "files",
      label: "Files",
      children: renderFileList(target.targetFiles),
    });
  }

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
      <Tabs items={tabItems} />
    </PortalCard>
  );
};
