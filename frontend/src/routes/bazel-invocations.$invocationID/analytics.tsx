import { useQuery } from "@apollo/client/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { ActionAnalyticsTab } from "@/components/ActionAnalyticsTab";
import { apolloClient } from "@/components/ApolloWrapper";
import { getFragmentData, gql } from "@/graphql/__generated__";
import {
  ActionAnalyticsState,
  type GetBazelInvocationActionAnalyticsQuery,
} from "@/graphql/__generated__/graphql";
import { NotFoundError } from "@/main";
import { generatePageTitle } from "@/utils/generatePageTitle";

const GET_BAZEL_INVOCATION_ACTION_ANALYTICS = gql(/* GraphQL */ `
  query GetBazelInvocationActionAnalytics($invocationID: UUID!) {
    getBazelInvocation(invocationID: $invocationID) {
      id
      bepCompleted
      actionAnalytics {
        ...BazelInvocationActionAnalytics
      }
    }
  }
`);

const BAZEL_INVOCATION_ACTION_ANALYTICS_FRAGMENT = gql(/* GraphQL */ `
  fragment BazelInvocationActionAnalytics on ActionAnalytics {
    state
    failureMessage
    startedAt
    completedAt
    executionLogStatus
    executionLogFailureMessage
    executionLogActionCount
    executionLogMatchedActions
    report {
      totalActions
      timedActions
      peakConcurrentActions
      averageConcurrency
      observedActionDuration {
        p95InMs
        maximumInMs
      }
      longestObservedActions {
        actionExecutionID
        label
        mnemonic
        runner
        observedDurationInMs
      }
      concurrency {
        elapsedTimeInMs
        concurrentActions
      }
      spawnMetricsActions
      remoteExecutionActions
      remoteQueueTime {
        sampleCount
        totalInMs
        p50InMs
        p95InMs
        maximumInMs
      }
      remoteExecutionWallTime {
        sampleCount
        p95InMs
        maximumInMs
      }
      queueToExecutionRatio
      longestQueueWaits {
        actionExecutionID
        label
        mnemonic
        runner
        platform {
          name
          value
        }
        observedDurationInMs
        totalTimeInMs
        queueTimeInMs
        executionWallTimeInMs
        inputBytes
        inputFiles
        memoryEstimateBytes
      }
      slowestExecutions {
        actionExecutionID
        label
        mnemonic
        runner
        platform {
          name
          value
        }
        observedDurationInMs
        totalTimeInMs
        queueTimeInMs
        executionWallTimeInMs
        inputBytes
        inputFiles
        memoryEstimateBytes
      }
      phaseStatistics {
        name
        statistics {
          totalInMs
        }
      }
      remoteMnemonicStatistics {
        name
        actionCount
        queueTime {
          sampleCount
          totalInMs
          p50InMs
          p95InMs
          maximumInMs
        }
        executionWallTime {
          sampleCount
          p95InMs
        }
      }
      remotePlatformStatistics {
        name
        actionCount
        queueTime {
          sampleCount
          totalInMs
          p50InMs
          p95InMs
          maximumInMs
        }
        executionWallTime {
          sampleCount
          p95InMs
        }
      }
    }
  }
`);

const parseInvocation = (
  invocation: NonNullable<
    GetBazelInvocationActionAnalyticsQuery["getBazelInvocation"]
  >,
) => ({
  analytics: getFragmentData(
    BAZEL_INVOCATION_ACTION_ANALYTICS_FRAGMENT,
    invocation.actionAnalytics,
  ),
  bepCompleted: invocation.bepCompleted,
});

export const Route = createFileRoute(
  "/bazel-invocations/$invocationID/analytics",
)({
  component: RouteComponent,
  loader: async ({ params }) => {
    const { data, error } = await apolloClient.query({
      errorPolicy: "all",
      query: GET_BAZEL_INVOCATION_ACTION_ANALYTICS,
      variables: { invocationID: params.invocationID },
      fetchPolicy: "network-only",
    });

    if (!data?.getBazelInvocation) {
      throw new NotFoundError("action analytics", error?.message);
    }

    return parseInvocation(data.getBazelInvocation);
  },
  head: (_ctx) => ({
    meta: [
      {
        title: generatePageTitle([
          "Invocation",
          "Analytics",
          _ctx.params.invocationID,
        ]),
      },
    ],
  }),
});

function RouteComponent() {
  const initialInvocation = Route.useLoaderData();
  const { invocationID } = Route.useParams();
  const { data, startPolling, stopPolling } = useQuery(
    GET_BAZEL_INVOCATION_ACTION_ANALYTICS,
    {
      variables: { invocationID },
      fetchPolicy: "cache-first",
    },
  );
  const invocation = data?.getBazelInvocation
    ? parseInvocation(data.getBazelInvocation)
    : initialInvocation;
  const shouldPoll =
    invocation.analytics.state === ActionAnalyticsState.Pending ||
    invocation.analytics.state === ActionAnalyticsState.Processing;

  useEffect(() => {
    if (shouldPoll) {
      startPolling(2000);
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [shouldPoll, startPolling, stopPolling]);

  return (
    <ActionAnalyticsTab
      analytics={invocation.analytics}
      bepCompleted={invocation.bepCompleted}
    />
  );
}
