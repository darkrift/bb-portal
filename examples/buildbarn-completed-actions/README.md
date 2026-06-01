# Buildbarn Completed Action Local Setup

Use Buildbarn's maintained docker-compose deployment as the base cluster and
load all overlays from this directory together. This setup includes:

- completed-action logging through `completed-action-relay`
- larger `maximumMessageSizeBytes` for local remote execution transfers
- a single-concurrency worker for `purpose=integration-test`
- an in-compose completed-action dump service for quick inspection

Load the local images into Docker with Bazel:

```sh
bazel run //cmd/grpc_tcp_relay:grpc_tcp_relay_container_load -- --platform linux/arm64
bazel run //cmd/completed_action_logger_dump:completed_action_logger_dump_container_load -- --platform linux/arm64
```

Use `linux/amd64` instead when running an amd64 Docker daemon.

Set the checkout paths and initialize the upstream compose volumes:

```sh
export BB_PORTAL_CHECKOUT=/path/to/bb-portal
export BB_DEPLOYMENTS_COMPOSE_DIR=/path/to/bb-deployments/docker-compose
export BB_PORTAL_COMPLETED_ACTION_OUT=/tmp/bb-portal-completed-actions

"$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/setup-compose-volumes.sh" \
  "$BB_DEPLOYMENTS_COMPOSE_DIR"
```

Start the full local setup:

```sh
docker compose \
  -f "$BB_DEPLOYMENTS_COMPOSE_DIR/docker-compose.yml" \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.completed-actions.yml" \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.large-messages.yml" \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.integration-test-worker.yml" \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.dump.yml" \
  up
```

On Docker Desktop for macOS, the FUSE worker bind mount uses shared propagation,
which is commonly rejected by Docker. Use the hardlinking workers only:

```sh
docker compose \
  -f "$BB_DEPLOYMENTS_COMPOSE_DIR/docker-compose.yml" \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.completed-actions.yml" \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.large-messages.yml" \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.integration-test-worker.yml" \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.dump.yml" \
  up \
  --scale worker-fuse-ubuntu22-04=0 \
  --scale runner-fuse-ubuntu22-04=0
```

The relay accepts completed-action logs from workers on
`completed-action-relay:8981` and forwards them to `completed-action-dump:8982`.
The dump service writes events to:

```text
$BB_PORTAL_COMPLETED_ACTION_OUT/completed-actions.ndjson
```

By default, the dump service publishes its host endpoint on `127.0.0.1:8985` to
avoid conflicting with a host `bb_portal` completed-action logger on `8982`.
Override it with:

```sh
export BB_PORTAL_COMPLETED_ACTION_DUMP_PORT=8986
```

The integration-test worker advertises the platform used by tests that request
`purpose=integration-test`:

```jsonnet
instanceNamePrefix: '',
concurrency: 1,
platform: {
  properties: [
    { name: 'purpose', value: 'integration-test' },
  ],
},
```

The large-message overlay raises `maximumMessageSizeBytes` to `64 MiB` for the
Buildbarn services that use the upstream compose default: frontend, storage,
scheduler, browser, and workers.
