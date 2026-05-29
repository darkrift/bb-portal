import { createFileRoute } from "@tanstack/react-router";
import { apolloClient } from "@/components/ApolloWrapper";
import {
  BazelInvocationTestDetailsPage,
  TEST_TARGET_METADATA_QUERY,
} from "@/components/pages/BazelInvocationTestDetails";
import { TargetNotFoundError } from "@/utils/notFound";
import { env } from "@/utils/env";
import { requireFeature } from "@/utils/featureGuard";
import { generatePageTitle } from "@/utils/generatePageTitle";

export const Route = createFileRoute("/bazel-invocations/$invocationID/tests/$targetID")({
  component: RouteComponent,
  beforeLoad: requireFeature(env.featureFlags?.bes?.pageTests),
  loader: async ({ params }) => {
    const { data } = await apolloClient.query({
      query: TEST_TARGET_METADATA_QUERY,
      variables: { id: params.targetID },
      fetchPolicy: "cache-first",
    });
    const target = data?.findTargets?.edges?.[0]?.node;
    if (!target) {
      throw new TargetNotFoundError();
    }
    return { target };
  },
  head: (_ctx) => {
    const label = _ctx.loaderData?.target.label;
    if (label === undefined) {
      return { meta: [{ title: generatePageTitle(["Test", "Not Found"]) }] };
    }
    return { meta: [{ title: generatePageTitle(["Test", label]) }] };
  },
});

function RouteComponent() {
  const { invocationID } = Route.useParams();
  const { target } = Route.useLoaderData();
  return (
    <BazelInvocationTestDetailsPage
      invocationID={invocationID}
      target={target}
    />
  );
}
