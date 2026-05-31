import { createFileRoute } from "@tanstack/react-router";
import { TestTab } from "@/components/TestTab";
import { generatePageTitle } from "@/utils/generatePageTitle";

export const Route = createFileRoute("/bazel-invocations/$invocationID/tests/")({
  component: RouteComponent,
  // TODO: Add backend integration test for this when the loader is implemented
  head: (_ctx) => ({
    meta: [
      {
        title: generatePageTitle([
          "Invocation",
          "Tests",
          _ctx.params.invocationID,
        ]),
      },
    ],
  }),
});

function RouteComponent() {
  const { invocationID } = Route.useParams();
  // TODO (isakstenstrom): Fetch data in the data loader
  return <TestTab invocationId={invocationID} />;
}
