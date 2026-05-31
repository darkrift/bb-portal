import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { BazelInvocationTargetLogsPanel } from "@/components/pages/BazelInvocationTargetDetails";

export const Route = createFileRoute(
  "/bazel-invocations/$invocationID/targets/$targetID/logs",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { instanceName, target } = useLoaderData({
    from: "/bazel-invocations/$invocationID/targets/$targetID",
  });

  return <BazelInvocationTargetLogsPanel instanceName={instanceName} target={target} />;
}
