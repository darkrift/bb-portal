# Completed Action Logger

`bb_portal` implements Buildbarn's `CompletedActionLogger` service through
`completedActionLoggerServiceConfiguration`. Workers can point their
`completed_action_loggers` configuration at that endpoint to stream completed
REv2 actions into the portal database.

The service uses the BES database and therefore requires
`besServiceConfiguration` to be set, but it has its own gRPC servers and
authentication policy:

```jsonnet
completedActionLoggerServiceConfiguration: {
  grpcServers: [{
    listenAddresses: [':8982'],
    authenticationPolicy: { allow: {} },
    maximumReceivedMessageSizeBytes: 10 * 1024 * 1024,
  }],
},
```

For local fixture generation, use the standalone dump service:

```sh
bazel run //cmd/completed_action_logger_dump -- \
  -listen 127.0.0.1:8981 \
  -output /tmp/completed-actions.ndjson
```

The dump service writes one `buildbarn.completedactionlogger.CompletedAction`
protobuf JSON message per line and acknowledges every received message. Capture
this file next to a BES JSON/NDJSON file from the same Bazel invocation to
iterate on correlation behavior without running the full portal database stack.

Point a worker at it with a client configuration equivalent to:

```json
{
  "completedActionLoggers": [
    {
      "client": {
        "address": "127.0.0.1:8981"
      },
      "maximumSendQueueSize": 10000
    }
  ]
}
```

When the worker runs in Docker and `bb_portal` runs on the host, use the TCP
relay:

```sh
bazel run //cmd/grpc_tcp_relay -- \
  -listen 0.0.0.0:8981 \
  -listen 0.0.0.0:8983 \
  -connect 127.0.0.1:8982
```

Workers can then use `completed-action-relay:8981` or the exposed host port.
See `examples/buildbarn-completed-actions/` for the docker-compose overlay.
