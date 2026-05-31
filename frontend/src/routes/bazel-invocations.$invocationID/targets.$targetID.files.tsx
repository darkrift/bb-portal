import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { BazelInvocationTargetFilesPanel } from "@/components/pages/BazelInvocationTargetDetails";

export const Route = createFileRoute(
  "/bazel-invocations/$invocationID/targets/$targetID/files",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { target } = useLoaderData({
    from: "/bazel-invocations/$invocationID/targets/$targetID",
  });

  return <BazelInvocationTargetFilesPanel files={target.targetFiles} />;
}
