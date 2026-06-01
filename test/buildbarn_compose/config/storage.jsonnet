local common = import 'common.libsonnet';

{
  grpcServers: [{
    listenAddresses: [':8981'],
    authenticationPolicy: { allow: {} },
  }],
  maximumMessageSizeBytes: common.maximumMessageSizeBytes,
  global: common.global,
  contentAddressableStorage: {
    backend: {
      'local': {
        keyLocationMapOnBlockDevice: {
          file: {
            path: '/storage-cas/key_location_map',
            sizeBytes: 64 * 1024 * 1024,
          },
        },
        keyLocationMapMaximumGetAttempts: 16,
        keyLocationMapMaximumPutAttempts: 64,
        oldBlocks: 2,
        currentBlocks: 4,
        newBlocks: 1,
        blocksOnBlockDevice: {
          source: {
            file: {
              path: '/storage-cas/blocks',
              sizeBytes: 512 * 1024 * 1024,
            },
          },
          spareBlocks: 1,
        },
        persistent: {
          stateDirectoryPath: '/storage-cas',
          minimumEpochInterval: '300s',
        },
      },
    },
    getAuthorizer: { allow: {} },
    putAuthorizer: { allow: {} },
    findMissingAuthorizer: { allow: {} },
  },
  actionCache: {
    backend: {
      'local': {
        keyLocationMapOnBlockDevice: {
          file: {
            path: '/storage-ac/key_location_map',
            sizeBytes: 1024 * 1024,
          },
        },
        keyLocationMapMaximumGetAttempts: 16,
        keyLocationMapMaximumPutAttempts: 64,
        oldBlocks: 2,
        currentBlocks: 4,
        newBlocks: 1,
        blocksOnBlockDevice: {
          source: {
            file: {
              path: '/storage-ac/blocks',
              sizeBytes: 20 * 1024 * 1024,
            },
          },
          spareBlocks: 1,
        },
        persistent: {
          stateDirectoryPath: '/storage-ac',
          minimumEpochInterval: '300s',
        },
      },
    },
    getAuthorizer: { allow: {} },
    putAuthorizer: { allow: {} },
  },
  fileSystemAccessCache: {
    backend: {
      'local': {
        keyLocationMapOnBlockDevice: {
          file: {
            path: '/storage-fsac/key_location_map',
            sizeBytes: 1024 * 1024,
          },
        },
        keyLocationMapMaximumGetAttempts: 16,
        keyLocationMapMaximumPutAttempts: 64,
        oldBlocks: 2,
        currentBlocks: 4,
        newBlocks: 1,
        blocksOnBlockDevice: {
          source: {
            file: {
              path: '/storage-fsac/blocks',
              sizeBytes: 20 * 1024 * 1024,
            },
          },
          spareBlocks: 1,
        },
        persistent: {
          stateDirectoryPath: '/storage-fsac',
          minimumEpochInterval: '300s',
        },
      },
    },
    getAuthorizer: { allow: {} },
    putAuthorizer: { allow: {} },
  },
}
