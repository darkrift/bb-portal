import { BorderInnerOutlined, FileSearchOutlined } from "@ant-design/icons";
import { useQuery } from "@apollo/client/react";
import { useQuery as useReactQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Space, Spin, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import React, { useMemo } from "react";
import DownloadButton from "@/components/DownloadButton";
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
import NullBooleanTag from "../../NullableBooleanTag";
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
type TestResultFileNode = NonNullable<
  NonNullable<TestResultNode["testResultFiles"]>[number]
>;

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

const RunStats: React.FC<{ items: StatItem[] }> = ({ items }) => {
  return (
    <div className={styles.runStats}>
      {items.map((item) => (
        <div key={item.title}>
          <Typography.Text
            type="secondary"
            className={styles.runStatLabel}
          >
            {item.title}
          </Typography.Text>
          <div className={styles.runStatValue}>{item.value ?? "-"}</div>
        </div>
      ))}
    </div>
  );
};

const ResultFileLinks: React.FC<{ files: TestResultFileNode[] | null | undefined }> = ({
  files,
}) => {
  const visibleFiles = useMemo(
    () =>
      [...(files || [])]
        .filter((file) => file.name && file.uri)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [files],
  );

  if (visibleFiles.length === 0) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }

  return (
    <Space direction="vertical" size={0}>
      {visibleFiles.map((file) => (
        <Typography.Link
          key={file.name}
          href={generateFileUrlFromBytestreamUri(file.uri, file.name) || file.uri}
          rel="noreferrer"
          target="_blank"
        >
          {file.name}
        </Typography.Link>
      ))}
    </Space>
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

const resultColumns: TableColumnsType<TestResultNode> = [
  {
    title: "Shard",
    dataIndex: "shard",
  },
  {
    title: "Attempt",
    dataIndex: "attempt",
  },
  {
    title: "Status",
    dataIndex: "status",
    render: (status) => (
      <TestStatusTag
        displayText={true}
        status={status as TestStatusEnum}
      />
    ),
  },
  {
    title: "Cached Locally",
    dataIndex: "cachedLocally",
    render: (value) => <NullBooleanTag status={value as boolean | null} />,
  },
  {
    title: "Cached Remotely",
    dataIndex: "cachedRemotely",
    render: (value) => <NullBooleanTag status={value as boolean | null} />,
  },
  {
    title: "Start",
    dataIndex: "testAttemptStart",
    render: (value) => formatTime(value),
  },
  {
    title: "Duration",
    dataIndex: "testAttemptDurationInMs",
    render: (value) => readableDurationFromMilliseconds(value, { smallestUnit: "ms" }),
    align: "right",
  },
  {
    title: "Strategy",
    dataIndex: "strategy",
    render: (value) => value || "-",
  },
  {
    title: "Exit Code",
    dataIndex: "exitCode",
    render: (value) => value ?? "-",
  },
  {
    title: "Hostname",
    dataIndex: "hostname",
    render: (value) => value || "-",
  },
  {
    title: "Files",
    dataIndex: "testResultFiles",
    render: (value) => <ResultFileLinks files={value as TestResultFileNode[] | null | undefined} />,
  },
];

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
      {result.timingBreakdown ? (
        <div>
          <Typography.Text strong>Timing Breakdown</Typography.Text>
          <Typography.Paragraph
            style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}
          >
            {JSON.stringify(result.timingBreakdown, null, 2)}
          </Typography.Paragraph>
        </div>
      ) : null}
    </Space>
  );
};

const RunSection: React.FC<{
  runGroup: RunGroup;
}> = ({ runGroup }) => {
  const { casByteStreamClient } = useGrpcClients();
  const testLogFile = runGroup.results
    .flatMap((result) => result.testResultFiles || [])
    .find((file) => file.name === "test.log" && file.uri);
  const testLogDownloadUrl = testLogFile
    ? generateFileUrlFromBytestreamUri(testLogFile.uri, testLogFile.name)
    : null;

  const { data: testLog, error: testLogError, isLoading: testLogLoading } =
    useReactQuery({
      queryKey: ["testLog", runGroup.run, testLogFile?.uri || ""],
      queryFn: async () => {
        if (!testLogFile?.uri) {
          return undefined;
        }
        return fetchBytestreamLog(casByteStreamClient, testLogFile.uri);
      },
      enabled: Boolean(testLogFile?.uri),
    });

  return (
    <section className={styles.runSection}>
      <div className={styles.runHeader}>
        <Typography.Title level={5} className={styles.runTitle}>
          Run {runGroup.run}
        </Typography.Title>
        <Typography.Text type="secondary">
          {runGroup.resultCount} results
        </Typography.Text>
      </div>
      <RunStats
        items={[
          { title: "Run Number", value: runGroup.run },
          { title: "Results", value: runGroup.resultCount },
          { title: "Shards", value: runGroup.shardCount },
          { title: "Attempts", value: runGroup.attemptCount },
          {
            title: "First Start",
            value: runGroup.firstAttemptStart
              ? runGroup.firstAttemptStart.toLocaleString()
              : "-",
          },
          {
            title: "Last End",
            value: runGroup.lastAttemptEnd
              ? runGroup.lastAttemptEnd.toLocaleString()
              : "-",
          },
          {
            title: "Attempt Time",
            value: readableDurationFromMilliseconds(
              runGroup.totalAttemptDurationInMs,
              { smallestUnit: "ms" },
            ),
          },
        ]}
      />
      {testLogFile ? (
        <PortalCard
          icon={<FileSearchOutlined />}
          titleBits={["Log"]}
          extraBits={
            testLogDownloadUrl
              ? [
                  <DownloadButton
                    key="download"
                    enabled={true}
                    buttonLabel="Download Log"
                    fileName={testLogFile.name}
                    url={testLogDownloadUrl}
                  />,
                ]
              : undefined
          }
          type="inner"
        >
          <LogViewer
            loading={testLogLoading}
            error={testLogError instanceof Error ? testLogError : null}
            log={testLog}
          />
        </PortalCard>
      ) : null}
      <Table<TestResultNode>
        rowKey="id"
        size="small"
        pagination={false}
        columns={resultColumns}
        dataSource={runGroup.results}
        expandable={{
          rowExpandable: (record) =>
            Boolean(
              record.statusDetails ||
                (record.warning && record.warning.length > 0) ||
                record.timingBreakdown,
            ),
          expandedRowRender: (record) => <ResultDetails result={record} />,
        }}
      />
    </section>
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

  return (
    <Space direction="vertical" size="middle" style={{ display: "flex" }}>
      <PortalCard
        icon={<BorderInnerOutlined />}
        titleBits={["Target", "Summary"]}
        type="inner"
      >
        <InfoStats
          items={[
            { title: "Instance Name", value: target.instanceName.name || "-" },
            { title: "Target Kind", value: target.targetKind || "-" },
            {
              title: "Target Label",
              value: target.id ? (
                <Space size={4}>
                  <Link to="/targets/$targetID/tests" params={{ targetID: target.id }}>
                    {target.label || "-"}
                  </Link>
                  <Typography.Text copyable={{ text: target.label || "-" }} />
                </Space>
              ) : (
                <Typography.Text copyable>{target.label || "-"}</Typography.Text>
              ),
            },
            { title: "Target Aspect", value: target.aspect || "-" },
            {
              title: "Invocation ID",
              value: <Typography.Text copyable>{invocationID}</Typography.Text>,
            },
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
              title: "Total Duration",
              value:
                testSummary?.totalRunDurationInMs !== undefined &&
                testSummary?.totalRunDurationInMs !== null
                  ? readableDurationFromMilliseconds(
                      testSummary.totalRunDurationInMs,
                      {
                        smallestUnit: "ms",
                      },
                    )
                  : "-",
            },
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
