import { ExperimentFilled } from "@ant-design/icons";
import { useQuery } from "@apollo/client/react";
import type { FilterValue, SorterResult } from "antd/es/table/interface";
import React, { useMemo } from "react";
import { Row, Space, Statistic } from "antd";
import PortalCard from "../PortalCard";
import {
  GetTestsForInvocationDocument,
  type GetTestsForInvocationQuery,
  OrderDirection,
  type TestSummaryOrder,
  TestSummaryOrderField,
  type TestSummaryWhereInput,
} from "@/graphql/__generated__/graphql";
import { parseGraphqlEdgeList } from "@/utils/parseGraphqlEdgeList";
import styles from "../../theme/theme.module.css";
import { CursorTable, getNewPaginationVariables } from "../CursorTable";
import type { PaginationVariables } from "../CursorTable/types";
import PortalAlert from "../PortalAlert";
import { columns, defaultSorting, type TestTabRowType } from "./columns";

interface Props {
  invocationId: string;
}

export const TestTab: React.FC<Props> = ({ invocationId }) => {
  const [paginationVariables, setPaginationVariables] =
    React.useState<PaginationVariables>(getNewPaginationVariables());
  const [filterVariables, setFilterVariables] = React.useState<
    Array<TestSummaryWhereInput>
  >([]);
  const [orderBy, setOrderBy] =
    React.useState<TestSummaryOrder>(defaultSorting);

  const { data, error, loading } = useQuery<GetTestsForInvocationQuery>(
    GetTestsForInvocationDocument,
    {
      variables: {
        where: {
          and: [
            {
              hasInvocationTargetWith: {
                hasBazelInvocationWith: { invocationID: invocationId },
              },
            },
            ...filterVariables,
          ],
        },
        orderBy,
        ...paginationVariables,
      },
      fetchPolicy: "cache-first",
      notifyOnNetworkStatusChange: true,
    },
  );

  const onFilterChange = (filters: Record<string, FilterValue | null>) => {
    const newFilters: TestSummaryWhereInput[] = [];
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value.length > 0) {
        switch (key) {
          case "overallStatus":
            newFilters.push({
              overallStatusIn:
                value as TestSummaryWhereInput["overallStatusIn"],
            });
            break;
          case "label":
            newFilters.push({
              hasInvocationTargetWith: [
                {
                  hasTargetWith: [
                    {
                      labelContainsFold: value[0] as string,
                    },
                  ],
                },
              ],
            });
            break;
        }
      }
    });
    setFilterVariables(newFilters);
  };

  const onSortChange = (
    sorter: SorterResult<TestTabRowType> | SorterResult<TestTabRowType>[],
  ) => {
    const s = Array.isArray(sorter) ? sorter[0] : sorter;
    if (!s || !s.order) {
      return;
    }
    switch (s.field) {
      case "totalRunDurationInMs":
        setOrderBy({
          field: TestSummaryOrderField.TotalRunDurationInMs,
          direction:
            s.order === "ascend" ? OrderDirection.Asc : OrderDirection.Desc,
        });
        break;
    }
  };

  const parsedData: TestTabRowType[] = useMemo(() => {
    return parseGraphqlEdgeList(data?.findTestSummaries).map((ts) => {
      var cachedLocally: boolean | null = null;
      var cachedRemotely: boolean | null = null;
      if (
        ts.testResults !== null &&
        ts.testResults !== undefined &&
        ts.testResults.length > 0
      ) {
        if (ts.testResults.every((tr) => tr.cachedLocally === true)) {
          cachedLocally = true;
        } else if (ts.testResults.some((tr) => tr.cachedLocally === false)) {
          cachedLocally = false;
        }
        if (ts.testResults.every((tr) => tr.cachedRemotely === true)) {
          cachedRemotely = true;
        } else if (ts.testResults.some((tr) => tr.cachedRemotely === false)) {
          cachedRemotely = false;
        }
      }
      return {
        ...ts,
        cachedLocally: cachedLocally,
        cachedRemotely: cachedRemotely,
      };
    });
  }, [data]);

  const summaryStats = useMemo(() => {
    const totals = {
      tests: parsedData.length,
      passed: 0,
      flaky: 0,
      failed: 0,
      incomplete: 0,
      noStatus: 0,
      runs: 0,
      attempts: 0,
      cached: 0,
    };

    parsedData.forEach((item) => {
      const summary = item as Partial<TestTabRowType> & {
        runCount?: number | null;
        attemptCount?: number | null;
        totalNumCached?: number | null;
      };
      totals.runs += summary.runCount ?? 0;
      totals.attempts += summary.attemptCount ?? 0;
      totals.cached += summary.totalNumCached ?? 0;
      switch (item.overallStatus) {
        case "PASSED":
          totals.passed += 1;
          break;
        case "FLAKY":
          totals.flaky += 1;
          break;
        case "INCOMPLETE":
          totals.incomplete += 1;
          break;
        case "NO_STATUS":
          totals.noStatus += 1;
          break;
        default:
          if (item.overallStatus !== null && item.overallStatus !== undefined) {
            totals.failed += 1;
          }
          break;
      }
    });

    return totals;
  }, [parsedData]);

  if (error) {
    return (
      <PortalAlert
        type="error"
        message={error.message}
        showIcon
        className={styles.alert}
      />
    );
  }

  return (
    <PortalCard
      type="inner"
      icon={<ExperimentFilled />}
      titleBits={[<span key="title">Tests Overview</span>]}
    >
      <Row>
        <Space size="large" wrap>
          <Statistic title="Tests" value={summaryStats.tests} />
          <Statistic title="Passed" value={summaryStats.passed} />
          <Statistic title="Flaky" value={summaryStats.flaky} />
          <Statistic title="Failed" value={summaryStats.failed} />
          <Statistic title="Incomplete" value={summaryStats.incomplete} />
          <Statistic title="No status" value={summaryStats.noStatus} />
          <Statistic title="Runs" value={summaryStats.runs} />
          <Statistic title="Attempts" value={summaryStats.attempts} />
          <Statistic title="Cached" value={summaryStats.cached} />
        </Space>
      </Row>
      <CursorTable
        size="small"
        columns={columns}
        dataSource={parsedData}
        loading={loading}
        rowKey={"id"}
        showSorterTooltip={{ target: "sorter-icon" }}
        pagination={{
          position: "bottom",
          justify: "end",
          size: "middle",
        }}
        onChange={(_pagination, filters, sorter, _extra) => {
          onFilterChange(filters);
          onSortChange(sorter);
        }}
        pageInfo={{
          startCursor: data?.findTestSummaries?.pageInfo.startCursor,
          endCursor: data?.findTestSummaries?.pageInfo.endCursor,
          hasNextPage: data?.findTestSummaries?.pageInfo.hasNextPage,
          hasPreviousPage: data?.findTestSummaries?.pageInfo.hasPreviousPage,
        }}
        paginationVariables={paginationVariables}
        setPaginationVariables={setPaginationVariables}
      />
    </PortalCard>
  );
};
