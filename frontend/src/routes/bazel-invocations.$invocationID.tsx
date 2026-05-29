import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/bazel-invocations/$invocationID")({
  component: Outlet,
});
