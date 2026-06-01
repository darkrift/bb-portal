local base = import 'worker-hardlinking-ubuntu22-04.jsonnet';

base {
  maximumMessageSizeBytes: 64 * 1024 * 1024,
  completedActionLoggers: [
    {
      client: {
        address: 'completed-action-relay:8981',
      },
      maximumSendQueueSize: 10000,
    },
  ],
}
