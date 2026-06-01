local base = import 'worker-fuse-ubuntu22-04.jsonnet';

base {
  completedActionLoggers: [
    {
      client: {
        address: 'completed-action-relay:8981',
      },
      maximumSendQueueSize: 10000,
    },
  ],
}
