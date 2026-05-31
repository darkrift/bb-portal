import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { BazelInvocationTargetTestSummaryPanel } from "@/components/pages/BazelInvocationTargetDetails";

export const Route = createFileRoute(
  "/bazel-invocations/$invocationID/targets/$targetID/test-summary",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { target } = useLoaderData({
    from: "/bazel-invocations/$invocationID/targets/$targetID",
  });

  return target.testSummary?.length ? (
    <BazelInvocationTargetTestSummaryPanel summary={target.testSummary[0]} />
  ) : null;
}
