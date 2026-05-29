import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotFoundPage } from "@/components/pages/NotFound";
import { TargetNotFoundError, TestNotFoundError } from "@/utils/notFound";
import { routeTree } from "./routeTree.gen";
import "./globals.css";
import { DisabledPage } from "./components/pages/DisabledPage";
import { ErrorPage } from "./components/pages/ErrorPage";
import { FeatureDisabledError } from "./utils/featureGuard";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultNotFoundComponent: () => <NotFoundPage />,
  defaultErrorComponent: ({ error }) => {
    switch (true) {
      case error instanceof FeatureDisabledError:
        return <DisabledPage />;
      case error instanceof TargetNotFoundError:
        return <NotFoundPage type="target" showUnauthenticatedMessage={true} />;
      case error instanceof TestNotFoundError:
        return <NotFoundPage type="test" showUnauthenticatedMessage={true} />;
      default:
        return <ErrorPage error={error} />;
    }
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// biome-ignore lint/style/noNonNullAssertion: This should never fail.
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
