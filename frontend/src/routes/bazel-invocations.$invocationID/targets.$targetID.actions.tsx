import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { BazelInvocationTargetActionsPanel } from "@/components/pages/BazelInvocationTargetDetails";

export const Route = createFileRoute(
  "/bazel-invocations/$invocationID/targets/$targetID/actions",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { instanceName, target, actions } = useLoaderData({
    from: "/bazel-invocations/$invocationID/targets/$targetID",
  });

  return actions ? (
    <BazelInvocationTargetActionsPanel
      instanceName={instanceName}
      actions={actions}
      targetLabel={target.target.label}
    />
  ) : null;
}
