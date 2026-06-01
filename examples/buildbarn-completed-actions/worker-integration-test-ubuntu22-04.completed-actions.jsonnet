local base = import '/config/worker-hardlinking-ubuntu22-04.jsonnet';

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
  buildDirectories: [
    base.buildDirectories[0] {
      runners: [
        base.buildDirectories[0].runners[0] {
          concurrency: 1,
          instanceNamePrefix: '',
          platform: {
            properties: [
              { name: 'purpose', value: 'integration-test' },
            ],
          },
          workerId+: {
            slot: '16',
            hostname: 'integration-test-worker.example.com',
          },
        },
      ],
    },
  ],
}
