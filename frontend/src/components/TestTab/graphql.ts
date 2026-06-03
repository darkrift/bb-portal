import { gql } from "@/graphql/__generated__";

export const GET_TESTS_FOR_INVOCATION = gql(/* GraphQl */ `
  query GetTestsForInvocation(
    $after: Cursor
    $first: Int
    $before: Cursor
    $last: Int
    $orderBy: TestSummaryOrder
    $where: TestSummaryWhereInput
  ) {
    testSummaryStats(where: $where) {
      tests
      passed
      flaky
      failed
      incomplete
      noStatus
      runs
      attempts
      cached
    }
    findTestSummaries(
      after: $after
      first: $first
      before: $before
      last: $last
      orderBy: $orderBy
      where: $where
    ) {
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
      edges {
        node {
          id
          overallStatus
          totalRunDurationInMs
          runCount
          attemptCount
          shardCount
          totalNumCached
          firstStartTime
          lastStopTime
          testResults {
            cachedLocally
            cachedRemotely
          }
          invocationTarget {
            bazelInvocation {
              invocationID
            }
            target {
              id
              instanceName {
                name
              }
              label
              aspect
              targetKind
            }
          }
        }
      }
    }
  }
`);
