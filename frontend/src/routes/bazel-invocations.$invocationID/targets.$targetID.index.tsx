import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { BazelInvocationTargetOverviewPanel } from "@/components/pages/BazelInvocationTargetDetails";

export const Route = createFileRoute(
  "/bazel-invocations/$invocationID/targets/$targetID/",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { invocationID, target } = useLoaderData({
    from: "/bazel-invocations/$invocationID/targets/$targetID",
  });

  return <BazelInvocationTargetOverviewPanel invocationID={invocationID} target={target} />;
}
