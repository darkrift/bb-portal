local common = import 'common.libsonnet';

{
  blobstore: common.blobstore,
  browserUrl: common.browserUrl,
  maximumMessageSizeBytes: common.maximumMessageSizeBytes,
  scheduler: { address: 'scheduler:8983' },
  global: common.global,
  completedActionLoggers: [{
    client: {
      address: 'bb-portal:8982',
    },
    maximumSendQueueSize: 10000,
  }],
  buildDirectories: [{
    native: {
      buildDirectoryPath: '/worker',
      cacheDirectoryPath: '/worker',
      maximumCacheFileCount: 1000,
      maximumCacheSizeBytes: 256 * 1024 * 1024,
      cacheReplacementPolicy: 'LEAST_RECENTLY_USED',
    },
    runners: [{
      endpoint: { address: 'unix:///runner/runner' },
      concurrency: 1,
      instanceNamePrefix: '',
      platform: {
        properties: [
          { name: 'purpose', value: 'integration-test' },
        ],
      },
      workerId: {
        datacenter: 'compose',
        rack: 'itest',
        slot: '1',
        hostname: 'integration-test-worker.example.com',
      },
    }],
  }],
  inputDownloadConcurrency: 2,
  outputUploadConcurrency: 2,
  directoryCache: {
    maximumCount: 100,
    maximumSizeBytes: 1024 * 1024,
    cacheReplacementPolicy: 'LEAST_RECENTLY_USED',
  },
}
