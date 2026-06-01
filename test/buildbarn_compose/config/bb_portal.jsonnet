{
  global: {
    diagnosticsHttpServer: {
      httpServers: [{
        listenAddresses: [':9980'],
        authenticationPolicy: { allow: {} },
      }],
      enablePrometheus: true,
    },
  },

  httpServers: [{
    listenAddresses: [':8080'],
    authenticationPolicy: { allow: {} },
  }],

  instanceNameAuthorizer: { allow: {} },
  maximumMessageSizeBytes: 64 * 1024 * 1024,

  besServiceConfiguration: {
    grpcServers: [{
      listenAddresses: [':8981'],
      authenticationPolicy: { allow: {} },
      maximumReceivedMessageSizeBytes: 64 * 1024 * 1024,
    }],
    database: {
      postgres: {
        connectionString: 'postgres://bb_portal:bb_portal@postgres:5432/bb_portal?sslmode=disable',
      },
      connectionPoolConfiguration: {
        maxOpenConnections: 10,
        maxIdleConnections: 10,
        connectionMaxLifetime: '120s',
        connectionMaxIdleTime: '30s',
      },
    },
    enableBepFileUpload: true,
    enableGraphqlPlayground: false,
    saveDataLevel: { basicAndTarget: {} },
    databaseCleanupConfiguration: {
      cleanupInterval: '3600s',
      invocationMessageTimeout: '3600s',
      invocationRetention: '86400s',
    },
    minEventBatchDuration: '0s',
    buildKey: 'build_id',
  },

  completedActionLoggerServiceConfiguration: {
    grpcServers: [{
      listenAddresses: [':8982'],
      authenticationPolicy: { allow: {} },
      maximumReceivedMessageSizeBytes: 64 * 1024 * 1024,
    }],
  },

  frontendServiceConfiguration: {
    frontendSource: { embedded: {} },
    frontendConfig: {
      companyName: 'bb-portal compose itest',
      grpcBackendUrl: 'grpc://bb-portal:8981',
      featureFlags: {
        bes: {
          pageBuilds: {},
          pageInvocations: {},
          pageTargets: {},
          pageTests: {},
          pageTrends: {},
        },
      },
    },
  },
}
