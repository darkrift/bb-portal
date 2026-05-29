import {
  BranchesOutlined,
  DownOutlined,
  FileOutlined,
  FileSearchOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { useQuery } from "@apollo/client/react";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, Input, Space, Spin, Tabs, Tooltip, Typography } from "antd";
import type { TabsProps } from "antd";
import React, { useMemo } from "react";
import DownloadButton from "@/components/DownloadButton";
import PortalDuration from "@/components/PortalDuration";
import { useGrpcClients } from "@/context/GrpcClientsContext";
import type {
  GetBazelInvocationTestDetailsQuery,
  TestSummaryWhereInput,
} from "@/graphql/__generated__/graphql";
import type { ByteStreamClient } from "@/lib/grpc-client/google/bytestream/bytestream";
import { fetchCasObject } from "@/utils/fetchCasObject";
import { generateFileUrlFromBytestreamUri, parseBytestreamUri } from "@/utils/bytestreamUri";
import { gql } from "@/graphql/__generated__";
import { parseGraphqlEdgeList } from "@/utils/parseGraphqlEdgeList";
import { TestNotFoundError } from "@/utils/notFound";
import { readableDurationFromMilliseconds } from "@/utils/time";
import Content from "../../Content";
import LogViewer from "../../LogViewer";
import PortalAlert from "../../PortalAlert";
import PortalCard from "../../PortalCard";
import TestStatusTag, { type TestStatusEnum } from "../../TestStatusTag";
import styles from "./index.module.css";

export const TEST_TARGET_METADATA_QUERY = gql(/* GraphQL */ `
  query GetInvocationTestTargetMetadata($id: ID!) {
    findTargets(where: { id: $id }) {
      edges {
        node {
          id
          aspect
          instanceName {
            name
          }
          label
          targetKind
        }
      }
    }
  }
`);

export const GET_BAZEL_INVOCATION_TEST_DETAILS = gql(/* GraphQL */ `
  query GetBazelInvocationTestDetails(
    $after: Cursor
    $first: Int
    $before: Cursor
    $last: Int
    $orderBy: TestSummaryOrder
    $where: TestSummaryWhereInput
  ) {
    findTestSummaries(
      after: $after
      first: $first
      before: $before
      last: $last
      orderBy: $orderBy
      where: $where
    ) {
      edges {
        node {
          id
          overallStatus
          totalRunCount
          runCount
          attemptCount
          shardCount
          totalNumCached
          firstStartTime
          lastStopTime
          totalRunDurationInMs
          invocationTarget {
            bazelInvocation {
              invocationID
            }
            target {
              id
            }
          }
          testResults {
            id
            run
            shard
            attempt
            status
            statusDetails
            cachedLocally
            testAttemptStart
            testAttemptDurationInMs
            warning
            strategy
            cachedRemotely
            exitCode
            hostname
            timingBreakdown
            testResultFiles {
              name
              uri
            }
          }
        }
      }
    }
  }
`);

type TestSummaryNode = NonNullable<
  NonNullable<
    NonNullable<GetBazelInvocationTestDetailsQuery["findTestSummaries"]["edges"]>[number]
  >["node"]
>;

type TestResultNode = NonNullable<NonNullable<TestSummaryNode["testResults"]>[number]>;

interface RunGroup {
  run: number;
  results: TestResultNode[];
  shardCount: number;
  attemptCount: number;
  resultCount: number;
  totalAttemptDurationInMs: number;
  firstAttemptStart: Date | null;
  lastAttemptEnd: Date | null;
}

interface TargetDetails {
  id: string;
  aspect: string;
  instanceName: {
    name: string;
  };
  label: string;
  targetKind: string;
}

interface Props {
  invocationID: string;
  target: TargetDetails;
}

interface StatItem {
  title: string;
  value: React.ReactNode;
}

interface TimingBreakdownNode {
  name?: string;
  durationMillis?: number;
  children?: TimingBreakdownNode[];
  Name?: string;
  DurationMillis?: number;
  Children?: TimingBreakdownNode[];
}

const getTimingBreakdownName = (node: TimingBreakdownNode): string => {
  return node.name || node.Name || "-";
};

const getTimingBreakdownDuration = (node: TimingBreakdownNode): number => {
  return node.durationMillis ?? node.DurationMillis ?? 0;
};

const getTimingBreakdownChildren = (
  node: TimingBreakdownNode,
): TimingBreakdownNode[] => {
  return node.children || node.Children || [];
};

const parseTime = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatTime = (value: unknown): string => {
  const parsed = parseTime(value);
  return parsed ? parsed.toLocaleString() : "-";
};

const getResultEndTime = (result: TestResultNode): Date | null => {
  if (!result.testAttemptStart || result.testAttemptDurationInMs == null) {
    return null;
  }
  const start = parseTime(result.testAttemptStart);
  if (!start) {
    return null;
  }
  return new Date(start.getTime() + result.testAttemptDurationInMs);
};

const groupResultsByRun = (results: TestResultNode[]): RunGroup[] => {
  const grouped = new Map<number, TestResultNode[]>();
  for (const result of results) {
    grouped.set(result.run, [...(grouped.get(result.run) || []), result]);
  }

  return [...grouped.entries()]
    .sort(([runA], [runB]) => runA - runB)
    .map(([run, runResults]) => {
      const sortedResults = [...runResults].sort(
        (a, b) => a.shard - b.shard || a.attempt - b.attempt,
      );
      const uniqueShards = new Set(sortedResults.map((result) => result.shard));
      const uniqueAttempts = new Set(
        sortedResults.map((result) => result.attempt),
      );
      const firstAttemptStart = sortedResults
        .map((result) => parseTime(result.testAttemptStart))
        .filter((value): value is Date => value !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const lastAttemptEnd = sortedResults
        .map((result) => getResultEndTime(result))
        .filter((value): value is Date => value !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const totalAttemptDurationInMs = sortedResults.reduce((sum, result) => {
        return sum + (result.testAttemptDurationInMs || 0);
      }, 0);

      return {
        run,
        results: sortedResults,
        shardCount: uniqueShards.size,
        attemptCount: uniqueAttempts.size,
        resultCount: sortedResults.length,
        totalAttemptDurationInMs,
        firstAttemptStart,
        lastAttemptEnd,
      };
    });
};

const InfoStats: React.FC<{ items: StatItem[] }> = ({ items }) => {
  return (
    <div
      style={{
        display: "grid",
        gap: "10px 24px",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      }}
    >
      {items.map((item) => (
        <div key={item.title}>
          <Typography.Text type="secondary" style={{ display: "block" }}>
            {item.title}
          </Typography.Text>
          <div style={{ marginTop: 2, lineHeight: 1.45 }}>
            {item.value ?? "-"}
          </div>
        </div>
      ))}
    </div>
  );
};

const fetchBytestreamLog = async (
  casByteStreamClient: ByteStreamClient,
  uri: string,
): Promise<string | undefined> => {
  const parsed = parseBytestreamUri(uri);
  if (!parsed) {
    return undefined;
  }

  const data = await fetchCasObject(
    casByteStreamClient,
    parsed.instanceName,
    parsed.digestFunction,
    parsed.digest,
  );
  return new TextDecoder().decode(data);
};

const countSearchTermMatches = (
  value: string | undefined,
  searchTerm: string,
): number => {
  const trimmedSearchTerm = searchTerm.trim();
  if (!value || !trimmedSearchTerm) {
    return 0;
  }

  const regex = new RegExp(
    trimmedSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "gi",
  );
  return value.match(regex)?.length ?? 0;
};

const ResultDetails: React.FC<{ result: TestResultNode }> = ({ result }) => {
  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      {result.statusDetails ? (
        <div>
          <Typography.Text strong>Status Details</Typography.Text>
          <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
            {result.statusDetails}
          </Typography.Paragraph>
        </div>
      ) : null}
      {result.warning && result.warning.length > 0 ? (
        <div>
          <Typography.Text strong>Warnings</Typography.Text>
          <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
            {result.warning.join("\n")}
          </Typography.Paragraph>
        </div>
      ) : null}
    </Space>
  );
};

const TimingPhaseRow: React.FC<{
  node: TimingBreakdownNode;
  index: number;
}> = ({ node, index }) => {
  const duration = getTimingBreakdownDuration(node);
  const name = getTimingBreakdownName(node);
  const label = `${name} - ${readableDurationFromMilliseconds(duration, {
    smallestUnit: "ms",
  })}`;
  const colors = [
    "#1677ff",
    "#52c41a",
    "#faad14",
    "#ff4d4f",
    "#722ed1",
    "#13c2c2",
  ];
  const accent = colors[index % colors.length];

  return (
    <Tooltip title={label}>
      <div className={styles.phaseChip}>
        <span className={styles.phaseBullet} style={{ backgroundColor: accent }} />
        <Typography.Text className={styles.phaseName}>{name}</Typography.Text>
        <Typography.Text type="secondary" className={styles.phaseDuration}>
          {readableDurationFromMilliseconds(duration, { smallestUnit: "ms" })}
        </Typography.Text>
      </div>
    </Tooltip>
  );
};

const TimingPhases: React.FC<{ breakdown: TimingBreakdownNode | null | undefined }> = ({
  breakdown,
}) => {
  if (!breakdown) {
    return null;
  }

  const breakdownJson = JSON.stringify(breakdown, null, 2);

  return (
    <div>
      <Tooltip
        title={
          <div className={styles.timingTooltipContent}>
            <Typography.Text strong>Nested timing information reported by Bazel for this test attempt.</Typography.Text>
            <pre className={styles.timingTooltipJson}>{breakdownJson}</pre>
          </div>
        }
      >
        <Typography.Text strong>
          Phase Breakdown: {readableDurationFromMilliseconds(getTimingBreakdownDuration(breakdown), { smallestUnit: "ms" })}
        </Typography.Text>
      </Tooltip>
      <div className={styles.phaseList}>
        {getTimingBreakdownChildren(breakdown).length ? (
          getTimingBreakdownChildren(breakdown).map((child, index) => (
            <TimingPhaseRow key={`${getTimingBreakdownName(child)}-${index}`} node={child} index={index} />
          ))
        ) : (
          <TimingPhaseRow node={breakdown} index={0} />
        )}
      </div>
    </div>
  );
};

const SummaryField: React.FC<StatItem> = ({ title, value }) => {
  return (
    <div>
      <Typography.Text type="secondary" className={styles.summaryFieldTitle}>
        {title}
      </Typography.Text>
      <div className={styles.summaryFieldValue}>{value ?? "-"}</div>
    </div>
  );
};

const AttemptSummary: React.FC<{ result: TestResultNode }> = ({ result }) => {
  return (
    <div className={styles.attemptSummary}>
      <SummaryField title="Shard" value={result.shard} />
      <SummaryField title="Attempt" value={result.attempt} />
      <SummaryField
        title="Status"
        value={<TestStatusTag displayText={true} status={result.status as TestStatusEnum} />}
      />
      <SummaryField
        title="Cached Locally"
        value={result.cachedLocally === true ? "yes" : result.cachedLocally === false ? "no" : "-"}
      />
      <SummaryField
        title="Cached Remotely"
        value={result.cachedRemotely === true ? "yes" : result.cachedRemotely === false ? "no" : "-"}
      />
      <SummaryField title="Start" value={formatTime(result.testAttemptStart)} />
      <SummaryField
        title="Duration"
        value={readableDurationFromMilliseconds(result.testAttemptDurationInMs, {
          smallestUnit: "ms",
        })}
      />
      <SummaryField title="Strategy" value={result.strategy || "-"} />
      <SummaryField title="Exit Code" value={result.exitCode ?? "-"} />
      <SummaryField title="Hostname" value={result.hostname || "-"} />
    </div>
  );
};

const AttemptLogSection: React.FC<{
  result: TestResultNode;
}> = ({ result }) => {
  const { casByteStreamClient } = useGrpcClients();
  const [logSearchDraft, setLogSearchDraft] = React.useState("");
  const [logSearchTerm, setLogSearchTerm] = React.useState("");
  const [activeMatchIndex, setActiveMatchIndex] = React.useState(0);
  const testLogFile = (result.testResultFiles || []).find(
    (file) => file.name === "test.log" && file.uri,
  );
  const testLogDownloadUrl = testLogFile
    ? generateFileUrlFromBytestreamUri(testLogFile.uri, testLogFile.name)
    : null;

  const { data: testLog, error: testLogError, isLoading: testLogLoading } =
    useReactQuery({
      queryKey: ["testLog", result.id, testLogFile?.uri || ""],
      queryFn: async () => {
        if (!testLogFile?.uri) {
          return undefined;
        }
        return fetchBytestreamLog(casByteStreamClient, testLogFile.uri);
      },
      enabled: Boolean(testLogFile?.uri),
    });
  const matchCount = React.useMemo(
    () => countSearchTermMatches(testLog, logSearchTerm),
    [testLog, logSearchTerm],
  );
  const handleLogSearch = React.useCallback((value: string) => {
    const nextValue = value.trim();
    setActiveMatchIndex(0);
    setLogSearchTerm(nextValue);
  }, []);
  const handlePreviousMatch = React.useCallback(() => {
    if (matchCount === 0) {
      return;
    }
    setActiveMatchIndex(
      (currentIndex) => (currentIndex - 1 + matchCount) % matchCount,
    );
  }, [matchCount]);
  const handleNextMatch = React.useCallback(() => {
    if (matchCount === 0) {
      return;
    }
    setActiveMatchIndex((currentIndex) => (currentIndex + 1) % matchCount);
  }, [matchCount]);

  React.useEffect(() => {
    setActiveMatchIndex(0);
  }, [testLog, logSearchTerm]);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <div className={styles.logToolbar}>
        <div className={styles.logSearchGroup}>
          <Input.Search
            allowClear
            className={styles.logSearch}
            enterButton={<SearchOutlined />}
            onChange={(event) => {
              const nextValue = event.target.value;
              setLogSearchDraft(nextValue);
              if (!nextValue.trim()) {
                setLogSearchTerm("");
                setActiveMatchIndex(0);
              }
            }}
            onSearch={handleLogSearch}
            placeholder="Search within this attempt"
            value={logSearchDraft}
          />
          <div className={styles.logSearchNavigation}>
            <Button
              aria-label="Previous match"
              disabled={matchCount === 0}
              icon={<UpOutlined />}
              onClick={handlePreviousMatch}
            />
            <Button
              aria-label="Next match"
              disabled={matchCount === 0}
              icon={<DownOutlined />}
              onClick={handleNextMatch}
            />
          </div>
          {logSearchTerm ? (
            <Typography.Text type="secondary" className={styles.logMatchCount}>
              {matchCount > 0
                ? `${activeMatchIndex + 1} / ${matchCount}`
                : "0 matches"}
            </Typography.Text>
          ) : null}
        </div>
        {testLogFile && testLogDownloadUrl ? (
          <DownloadButton
            enabled={true}
            buttonLabel="Download Log"
            fileName={testLogFile.name}
            url={testLogDownloadUrl}
          />
        ) : null}
      </div>
      <LogViewer
        loading={testLogLoading}
        error={testLogError instanceof Error ? testLogError : null}
        log={testLog}
        searchTerm={logSearchTerm}
        activeMatchIndex={activeMatchIndex}
      />
    </Space>
  );
};

const AttemptFilesSection: React.FC<{
  result: TestResultNode;
}> = ({ result }) => {
  const files = React.useMemo(
    () =>
      [...(result.testResultFiles || [])]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((file) => ({
          ...file,
          url: file.uri ? generateFileUrlFromBytestreamUri(file.uri, file.name) : null,
        })),
    [result.testResultFiles],
  );

  if (files.length === 0) {
    return (
      <Typography.Text type="secondary">
        No attached files were reported for this attempt.
      </Typography.Text>
    );
  }

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      {files.map((file) => (
        <div key={`${file.name}-${file.uri}`}>
          {file.url ? (
            <a href={file.url} target="_blank" rel="noreferrer">
              {file.name}
            </a>
          ) : (
            <Typography.Text>{file.name}</Typography.Text>
          )}
        </div>
      ))}
    </Space>
  );
};

const AttemptDetails: React.FC<{
  result: TestResultNode;
}> = ({ result }) => {
  const [activeTab, setActiveTab] = React.useState<string>("overview");

  const items = React.useMemo<TabsProps["items"]>(
    () => [
      {
        key: "overview",
        label: (
          <Space size={4}>
            <InfoCircleOutlined />
            <span>Overview</span>
          </Space>
        ),
        children: (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <AttemptSummary result={result} />
            <ResultDetails result={result} />
          </Space>
        ),
      },
      {
        key: "log",
        label: (
          <Space size={4}>
            <FileSearchOutlined />
            <span>Logs</span>
          </Space>
        ),
        children: <AttemptLogSection result={result} />,
      },
      {
        key: "phase",
        label: (
          <Space size={4}>
            <BranchesOutlined />
            <span>Phases</span>
          </Space>
        ),
        children: (
          <TimingPhases
            breakdown={
              result.timingBreakdown as TimingBreakdownNode | null | undefined
            }
          />
        ),
      },
      {
        key: "files",
        label: (
          <Space size={4}>
            <FileOutlined />
            <span>Files</span>
          </Space>
        ),
        children: <AttemptFilesSection result={result} />,
      },
    ],
    [result],
  );

  return (
    <Tabs
      activeKey={activeTab}
      items={items}
      onChange={setActiveTab}
      destroyInactiveTabPane={true}
      size="small"
      className={styles.attemptTabs}
    />
  );
};

const RunSection: React.FC<{
  runGroup: RunGroup;
}> = ({ runGroup }) => {
  const primaryResult =
    runGroup.results.find((result) => result.status) ?? runGroup.results[0];
  const runStatus =
    primaryResult?.status ??
    runGroup.results.find((result) => result.status)?.status ??
    "NO_STATUS";
  const titleBits = [
    <span key="run">
      Run:{" "}
      <Typography.Text type="secondary" className={styles.normalWeight}>
        {runGroup.run}
      </Typography.Text>
    </span>,
    <span key="shard">
      Shard:{" "}
      <Typography.Text type="secondary" className={styles.normalWeight}>
        {primaryResult?.shard ?? "-"}
      </Typography.Text>
    </span>,
    <span key="attempt">
      Attempt:{" "}
      <Typography.Text type="secondary" className={styles.normalWeight}>
        {primaryResult?.attempt ?? "-"}
      </Typography.Text>
    </span>,
    <span key="status">
      Status:{" "}
      <Typography.Text type="secondary" className={styles.normalWeight}>
        <TestStatusTag
          displayText={true}
          status={runStatus as TestStatusEnum}
        />
      </Typography.Text>
    </span>,
  ];
  return (
    <PortalCard
      icon={null}
      titleBits={titleBits}
      extraBits={[
        runGroup.firstAttemptStart && runGroup.lastAttemptEnd ? (
          <PortalDuration
            key="run-duration"
            from={runGroup.firstAttemptStart.toISOString()}
            to={runGroup.lastAttemptEnd.toISOString()}
            includeIcon
            includePopover
            formatConfig={{ smallestUnit: "ms" }}
          />
        ) : null,
      ].filter(Boolean) as React.ReactNode[]}
      alwaysShowExtra={true}
      type="inner"
      className={styles.runCard}
    >
      {primaryResult ? <AttemptDetails result={primaryResult} /> : null}
    </PortalCard>
  );
};

export const BazelInvocationTestDetails: React.FC<Props> = ({
  invocationID,
  target,
}) => {
  const targetQueryWhere = useMemo<TestSummaryWhereInput>(
    () => ({
      and: [
        {
          hasInvocationTargetWith: [
            {
              hasBazelInvocationWith: [{ invocationID }],
              hasTargetWith: [{ id: target.id }],
            },
          ],
        },
      ],
    }),
    [invocationID, target.id],
  );

  const { data, loading, error } = useQuery<GetBazelInvocationTestDetailsQuery>(
    GET_BAZEL_INVOCATION_TEST_DETAILS,
    {
      variables: {
        first: 1,
        where: targetQueryWhere,
      },
      fetchPolicy: "network-only",
    },
  );

  const testSummary = parseGraphqlEdgeList(data?.findTestSummaries)[0];
  const runGroups = useMemo(
    () => groupResultsByRun(testSummary?.testResults || []),
    [testSummary],
  );

  if (error) {
    return (
      <PortalAlert
        showIcon
        type="error"
        message="Error fetching test details"
        description={
          error.message ||
          "Unknown error occurred while fetching data from the server."
        }
      />
    );
  }

  if (loading && !testSummary) {
    return <Spin />;
  }

  if (!loading && !testSummary) {
    throw new TestNotFoundError();
  }

  const targetTitleBits = [
    <span key="target">
      Target:{" "}
      <Typography.Text type="secondary" className={styles.normalWeight}>
        {target.id ? (
          <Link to="/targets/$targetID/tests" params={{ targetID: target.id }}>
            {target.label || "-"}
          </Link>
        ) : (
          target.label || "-"
        )}
      </Typography.Text>
    </span>,
  ];

  return (
    <Space direction="vertical" size="middle" style={{ display: "flex" }}>
      <PortalCard
        icon={null}
        titleBits={targetTitleBits}
        extraBits={[
          testSummary?.firstStartTime && testSummary?.lastStopTime ? (
            <PortalDuration
              key="target-duration"
              from={testSummary.firstStartTime}
              to={testSummary.lastStopTime}
              includeIcon
              includePopover
              formatConfig={{ smallestUnit: "ms" }}
            />
          ) : null,
        ].filter(Boolean) as React.ReactNode[]}
        alwaysShowExtra={true}
        type="inner"
      >
        <InfoStats
          items={[
            { title: "Instance Name", value: target.instanceName.name || "-" },
            { title: "Target Kind", value: target.targetKind || "-" },
            { title: "Target Aspect", value: target.aspect || "-" },
            {
              title: "Overall Status",
              value: testSummary?.overallStatus ? (
                <TestStatusTag
                  displayText={true}
                  status={testSummary.overallStatus as TestStatusEnum}
                />
              ) : (
                "-"
              ),
            },
            { title: "Runs Per Test", value: testSummary?.runCount ?? "-" },
            { title: "Observed Runs", value: runGroups.length || "-" },
            { title: "Attempt Count", value: testSummary?.attemptCount ?? "-" },
            { title: "Shard Count", value: testSummary?.shardCount ?? "-" },
            { title: "Total Runs", value: testSummary?.totalRunCount ?? "-" },
            { title: "Cached Results", value: testSummary?.totalNumCached ?? "-" },
            {
              title: "First Start",
              value: testSummary?.firstStartTime
                ? formatTime(testSummary.firstStartTime)
                : "-",
            },
            {
              title: "Last Stop",
              value: testSummary?.lastStopTime
                ? formatTime(testSummary.lastStopTime)
                : "-",
            },
          ]}
        />
      </PortalCard>
      <div className={styles.runList}>
        {runGroups.map((runGroup) => (
          <RunSection key={runGroup.run} runGroup={runGroup} />
        ))}
      </div>
    </Space>
  );
};

export const BazelInvocationTestDetailsPage: React.FC<Props> = (params) => {
  return (
    <Content content={<BazelInvocationTestDetails {...params} />} />
  );
};
