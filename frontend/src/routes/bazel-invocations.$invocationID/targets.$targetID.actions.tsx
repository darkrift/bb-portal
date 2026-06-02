import { createFileRoute, notFound } from "@tanstack/react-router";
import { apolloClient } from "@/components/ApolloWrapper";
import { BazelInvocationTargetActionsPanel } from "@/components/pages/BazelInvocationTargetDetails";
import { getFragmentData, gql } from "@/graphql/__generated__";
import type { BazelInvocationActionsFragment } from "@/graphql/__generated__/graphql";

const GET_BAZEL_INVOCATION_TARGET_ACTIONS = gql(/* GraphQL */ `
  query GetBazelInvocationTargetActions($invocationID: UUID!, $targetID: ID!) {
    getBazelInvocation(invocationID: $invocationID) {
      id
      instanceName {
        name
      }
      actionsForTarget(targetID: $targetID) {
        ...BazelInvocationActions
      }
    }
  }
`);

const BAZEL_INVOCATION_ACTIONS_FRAGMENT = gql(/* GraphQL */ `
  fragment BazelInvocationActions on Action {
    id
    label
    type
    success
    exitCode
    commandLine
    startTime
    endTime
    failureCode
    failureMessage
    stdoutHash
    stdoutSizeBytes
    stdoutHashFunction
    stderrHash
    stderrSizeBytes
    stderrHashFunction
    actionFiles {
      name
      uri
    }
    completedActions {
      id
      uuid
      instanceName
      actionDigestHash
      actionDigestSizeBytes
      digestFunction
      toolInvocationID
      correlatedInvocationsID
      targetID
      actionMnemonic
      cacheHit
      exitCode
      statusCode
      statusMessage
      queuedAt
      workerStartAt
      workerCompletedAt
      uploadedAt
      stdoutHash
      stdoutSizeBytes
      stderrHash
      stderrSizeBytes
    }
    configuration {
      id
      configurationID
      mnemonic
      platformName
      cpu
      makeVariables
    }
  }
`);

export const Route = createFileRoute(
  "/bazel-invocations/$invocationID/targets/$targetID/actions",
)({
  component: RouteComponent,
  loader: async ({ params }) => {
    const { data } = await apolloClient.query({
      query: GET_BAZEL_INVOCATION_TARGET_ACTIONS,
      variables: {
        invocationID: params.invocationID,
        targetID: params.targetID,
      },
      fetchPolicy: "network-only",
    });

    if (!data?.getBazelInvocation) {
      throw notFound();
    }

    const actions = getFragmentData(
      BAZEL_INVOCATION_ACTIONS_FRAGMENT,
      data.getBazelInvocation.actionsForTarget,
    ) as BazelInvocationActionsFragment[];

    return {
      instanceName: data.getBazelInvocation.instanceName.name,
      actions,
    };
  },
});

function RouteComponent() {
  const { instanceName, actions } = Route.useLoaderData();

  return (
    <BazelInvocationTargetActionsPanel
      instanceName={instanceName}
      actions={actions}
    />
  );
}
