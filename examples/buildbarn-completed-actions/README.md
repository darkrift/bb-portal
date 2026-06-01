# Buildbarn Completed Action Local Setup

Use Buildbarn's maintained docker-compose deployment as the base cluster and
add the relay service from this directory. The relay is a TCP tunnel for gRPC:
workers connect to it from Docker, and it forwards the byte stream to
`bb_portal` running on the host.

Start `bb_portal` on the host with
`completedActionLoggerServiceConfiguration.grpcServers` listening on `8982`.
This service has its own listener and authentication policy, separate from the
Bazel BES listener.

Load the relay image into Docker with Bazel:

```sh
bazel run //cmd/grpc_tcp_relay:grpc_tcp_relay_container_load -- --platform linux/arm64
```

Use `linux/amd64` instead when running an amd64 Docker daemon. Then run the
relay overlay:

```sh
export BB_PORTAL_CHECKOUT=/path/to/bb-portal

docker compose \
  -f path/to/bb-deployments/docker-compose/docker-compose.yml \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.completed-actions.yml" \
  up
```

The overlay is not a standalone compose file; it must be loaded after
Buildbarn's base compose file so the worker service definitions are present.
The `BB_PORTAL_CHECKOUT` variable is used for host bind mounts. Without it,
Compose may resolve the wrapper Jsonnet paths relative to `bb-deployments`,
which means the worker starts without the completed-action override.

The upstream compose deployment also expects its volume directories to exist.
If you are not using `bb-deployments/docker-compose/run.sh`, initialize them:

```sh
"$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/setup-compose-volumes.sh" \
  /path/to/bb-deployments/docker-compose
```

On Docker Desktop for macOS, the FUSE worker bind mount uses shared propagation,
which is commonly rejected by Docker. Use the hardlinking worker only:

```sh
docker compose \
  -f path/to/bb-deployments/docker-compose/docker-compose.yml \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.completed-actions.yml" \
  up \
  --scale worker-fuse-ubuntu22-04=0 \
  --scale runner-fuse-ubuntu22-04=0
```

The overlay also overrides the two worker services from Buildbarn's compose
file:

```yaml
worker-fuse-ubuntu22-04:
  command:
    - /config/worker-fuse-ubuntu22-04.completed-actions.jsonnet

worker-hardlinking-ubuntu22-04:
  command:
    - /config/worker-hardlinking-ubuntu22-04.completed-actions.jsonnet
```

Those wrapper configs import the upstream worker configs and add:

```jsonnet
completedActionLoggers: [
  {
    client: { address: 'completed-action-relay:8981' },
    maximumSendQueueSize: 10000,
  },
],
```

For a quick connectivity check without the full portal database, run the dump
service on the host and point the relay at it:

```sh
bazel run //cmd/completed_action_logger_dump -- \
  -listen 127.0.0.1:8982 \
  -output /tmp/completed-actions.ndjson
```

Then start the relay compose overlay. Any completed actions sent by workers to
`completed-action-relay:8981` will be written to the NDJSON file.

Alternatively, run the dump service in compose:

```sh
export BB_PORTAL_CHECKOUT=/path/to/bb-portal
export BB_PORTAL_COMPLETED_ACTION_OUT=/tmp/bb-portal-completed-actions

bazel run //cmd/grpc_tcp_relay:grpc_tcp_relay_container_load -- --platform linux/arm64
bazel run //cmd/completed_action_logger_dump:completed_action_logger_dump_container_load -- --platform linux/arm64

docker compose \
  -f path/to/bb-deployments/docker-compose/docker-compose.yml \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.completed-actions.yml" \
  -f "$BB_PORTAL_CHECKOUT/examples/buildbarn-completed-actions/docker-compose.dump.yml" \
  up
```

In this mode, workers send to `completed-action-relay:8981`, the relay forwards
to `completed-action-dump:8982`, and the dump service also exposes port `8982`
on the host for direct local testing. Events are written to:

```text
$BB_PORTAL_COMPLETED_ACTION_OUT/completed-actions.ndjson
```
