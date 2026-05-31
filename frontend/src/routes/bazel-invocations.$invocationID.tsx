import { createFileRoute, notFound } from "@tanstack/react-router";
import { apolloClient } from "@/components/ApolloWrapper";
import { BazelInvocationDetailsPage } from "@/components/pages/BazelInvocationDetails";
import { getFragmentData, gql } from "@/graphql/__generated__";
import { env } from "@/utils/env";
import { requireFeature } from "@/utils/featureGuard";
import { generatePageTitle } from "@/utils/generatePageTitle";

const GET_BAZEL_INVOCATION_OVERVIEW = gql(/* GraphQL */ `
  query GetBazelInvocationOverview($invocationID: UUID!) {
    getBazelInvocation(invocationID: $invocationID) {
      ...BazelInvocationOverview
    }
  }
`);

const BAZEL_INVOCATION_OVERVIEW_FRAGMENT = gql(/* GraphQL */ `
  fragment BazelInvocationOverview on BazelInvocation {
    id
    invocationID
    actions {
      id
    }
    metrics {
      id
    }
    sourceControl {
      id
    }
    tags {
      totalCount
    }
    startedAt
    endedAt
    exitCodeName
    instanceName {
      id
      name
    }
    hostname
    connectionMetadata {
      id
      connectionLastOpenAt
      timeSinceLastConnectionMillis
    }
    originalCommandLine
    configurations {
      id
      cpu
      mnemonic
    }
    numFetches
    bazelVersion
    username
    authenticatedUser {
      id
    }
    build {
      id
      buildUUID
    }
    profile {
      digest
      digestFunction
      name
      sizeInBytes
    }
  }
`);

export const Route = createFileRoute("/bazel-invocations/$invocationID")({
  component: RouteComponent,
  beforeLoad: requireFeature(env.featureFlags?.bes?.pageInvocations),
  loader: async ({ params }) => {
    const { data } = await apolloClient.query({
      query: GET_BAZEL_INVOCATION_OVERVIEW,
      variables: { invocationID: params.invocationID },
      fetchPolicy: "network-only",
    });

    if (!data?.getBazelInvocation) {
      throw notFound();
    }

    return {
      invocation: getFragmentData(
        BAZEL_INVOCATION_OVERVIEW_FRAGMENT,
        data.getBazelInvocation,
      ),
    };
  },
  head: (_ctx) => ({
    meta: [
      {
        title: generatePageTitle([
          "Invocation",
          "Overview",
          _ctx.params.invocationID,
        ]),
      },
    ],
  }),
});

function RouteComponent() {
  const { invocation } = Route.useLoaderData();
  return <BazelInvocationDetailsPage invocation={invocation} />;
}
