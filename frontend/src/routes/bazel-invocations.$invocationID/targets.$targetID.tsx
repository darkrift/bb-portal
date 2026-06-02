import { createFileRoute, notFound } from "@tanstack/react-router";
import { apolloClient } from "@/components/ApolloWrapper";
import { BazelInvocationTargetDetailsPage } from "@/components/pages/BazelInvocationTargetDetails";
import { gql } from "@/graphql/__generated__";
import { env } from "@/utils/env";
import { requireFeature } from "@/utils/featureGuard";
import { generatePageTitle } from "@/utils/generatePageTitle";

const GET_BAZEL_INVOCATION_TARGET_DETAILS = gql(/* GraphQL */ `
  query GetBazelInvocationTargetDetails($invocationID: UUID!, $targetID: ID!) {
    getBazelInvocation(invocationID: $invocationID) {
      id
      invocationID
      instanceName {
        name
      }
      hasActionsForTarget(targetID: $targetID)
      invocationTargets(
        first: 1
        where: {
          hasTargetWith: { id: $targetID }
          hasBazelInvocationWith: { invocationID: $invocationID }
        }
      ) {
        edges {
          node {
            id
            success
            abortReason
            durationInMs
            failureMessage
            tags
            startTimeInMs
            endTimeInMs
            target {
              id
              label
              aspect
              targetKind
              instanceName {
                name
              }
            }
            targetFiles {
              name
              uri
            }
            testSummary {
              id
              overallStatus
              runCount
              attemptCount
              shardCount
              totalNumCached
              totalRunDurationInMs
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
    }
  }
`);

export const Route = createFileRoute(
  "/bazel-invocations/$invocationID/targets/$targetID",
)({
  component: RouteComponent,
  beforeLoad: requireFeature(env.featureFlags?.bes?.pageTargets),
  loader: async ({ params }) => {
    const { data } = await apolloClient.query({
      query: GET_BAZEL_INVOCATION_TARGET_DETAILS,
      variables: {
        invocationID: params.invocationID,
        targetID: params.targetID,
      },
      fetchPolicy: "network-only",
    });

    const target = data?.getBazelInvocation?.invocationTargets?.edges?.[0]?.node;
    if (!data?.getBazelInvocation || !target) {
      throw notFound();
    }

    return {
      invocationID: data.getBazelInvocation.invocationID,
      instanceName: data.getBazelInvocation.instanceName.name,
      target,
      hasActions: data.getBazelInvocation.hasActionsForTarget,
    };
  },
  head: (_ctx) => ({
    meta: [
      {
        title: generatePageTitle([
          "Invocation",
          "Target",
          _ctx.params.invocationID,
        ]),
      },
    ],
  }),
});

function RouteComponent() {
  const { invocationID, target, hasActions } = Route.useLoaderData();
  return (
    <BazelInvocationTargetDetailsPage
      invocationID={invocationID}
      target={target}
      hasActions={hasActions}
    />
  );
}
