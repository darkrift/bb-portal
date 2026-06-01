{
  maximumMessageSizeBytes: 64 * 1024 * 1024,
  blobstore: {
    contentAddressableStorage: {
      grpc: {
        client: { address: 'storage:8981' },
      },
    },
    actionCache: {
      completenessChecking: {
        backend: {
          grpc: {
            client: { address: 'storage:8981' },
          },
        },
        maximumTotalTreeSizeBytes: 64 * 1024 * 1024,
      },
    },
  },
  fileSystemAccessCache: {
    grpc: {
      client: { address: 'storage:8981' },
    },
  },
  browserUrl: 'http://localhost:7984',
  global: {
    diagnosticsHttpServer: {
      httpServers: [{
        listenAddresses: [':9980'],
        authenticationPolicy: { allow: {} },
      }],
      enablePrometheus: true,
      enablePprof: true,
      enableActiveSpans: true,
    },
  },
}
