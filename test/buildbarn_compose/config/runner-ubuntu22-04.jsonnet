local common = import 'common.libsonnet';

{
  buildDirectoryPath: '/worker',
  global: common.global,
  grpcServers: [{
    listenPaths: ['/runner/runner'],
    authenticationPolicy: { allow: {} },
  }],
}
