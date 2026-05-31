import { createFileRoute, notFound } from "@tanstack/react-router";
import { apolloClient } from "@/components/ApolloWrapper";
import { BazelInvocationTestDetailsPage } from "@/components/pages/BazelInvocationTestDetails";
import { gql } from "@/graphql/__generated__";
import { env } from "@/utils/env";
import { requireFeature } from "@/utils/featureGuard";
import { generatePageTitle } from "@/utils/generatePageTitle";

const GET_BAZEL_INVOCATION_TEST_DETAILS = gql(/* GraphQL */ `
  query GetBazelInvocationTestDetails(
    $invocationID: UUID!
    $targetID: ID!
  ) {
    getBazelInvocation(invocationID: $invocationID) {
      id
      invocationID
    }
    findTestSummaries(
      first: 1
      where: {
        and: [
          {
            hasInvocationTargetWith: {
              hasTargetWith: { id: $targetID }
              hasBazelInvocationWith: { invocationID: $invocationID }
            }
          }
        ]
      }
    ) {
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
          invocationTarget {
            target {
              id
              label
              aspect
              targetKind
              instanceName {
                name
              }
            }
          }
          testResults {
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

export const Route = createFileRoute(
  "/bazel-invocations/$invocationID/tests/$targetID",
)({
  component: RouteComponent,
  beforeLoad: requireFeature(env.featureFlags?.bes?.pageTests),
  loader: async ({ params }) => {
    const { data } = await apolloClient.query({
      query: GET_BAZEL_INVOCATION_TEST_DETAILS,
      variables: {
        invocationID: params.invocationID,
        targetID: params.targetID,
      },
      fetchPolicy: "network-only",
    });

    const summary = data?.findTestSummaries?.edges?.[0]?.node;
    if (!data?.getBazelInvocation || !summary) {
      throw notFound();
    }

    return { summary };
  },
  head: (_ctx) => {
    const label = _ctx.loaderData?.summary?.invocationTarget?.target?.label;
    return {
      meta: [
        {
          title: generatePageTitle(["Test", label || "Not Found"]),
        },
      ],
    };
  },
});

function RouteComponent() {
  const { summary } = Route.useLoaderData();
  return <BazelInvocationTestDetailsPage summary={summary} />;
}
