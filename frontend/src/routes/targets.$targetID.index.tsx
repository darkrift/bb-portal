import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { TargetDetailsPage } from "@/components/pages/TargetDetails";

export const Route = createFileRoute("/targets/$targetID/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { target } = useLoaderData({
    from: "/targets/$targetID",
  });
  return (
    <TargetDetailsPage
      aspect={target.aspect}
      instanceName={target.instanceName.name}
      targetKind={target.targetKind}
      label={target.label}
    />
  );
}
