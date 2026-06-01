#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/bb-deployments/docker-compose" >&2
  exit 1
fi

compose_dir=$1
volumes_dir="${compose_dir}/volumes"

mkdir -p "${volumes_dir}"

mkdir -p \
  "${volumes_dir}/bb" \
  "${volumes_dir}/worker-fuse-ubuntu22-04/build" \
  "${volumes_dir}/worker-fuse-ubuntu22-04/cas/persistent_state" \
  "${volumes_dir}/worker-fuse-ubuntu22-04/cache" \
  "${volumes_dir}/worker-hardlinking-ubuntu22-04/build" \
  "${volumes_dir}/worker-hardlinking-ubuntu22-04/cas/persistent_state" \
  "${volumes_dir}/worker-hardlinking-ubuntu22-04/cache" \
  "${volumes_dir}/worker-integration-test-ubuntu22-04/build" \
  "${volumes_dir}/worker-integration-test-ubuntu22-04/cas/persistent_state" \
  "${volumes_dir}/worker-integration-test-ubuntu22-04/cache" \
  "${volumes_dir}/storage-ac-0/persistent_state" \
  "${volumes_dir}/storage-ac-1/persistent_state" \
  "${volumes_dir}/storage-cas-0/persistent_state" \
  "${volumes_dir}/storage-cas-1/persistent_state" \
  "${volumes_dir}/storage-fsac-0/persistent_state" \
  "${volumes_dir}/storage-fsac-1/persistent_state"

chmod 0777 \
  "${volumes_dir}/worker-fuse-ubuntu22-04" \
  "${volumes_dir}/worker-fuse-ubuntu22-04/build" \
  "${volumes_dir}/worker-fuse-ubuntu22-04/cas" \
  "${volumes_dir}/worker-fuse-ubuntu22-04/cas/persistent_state" \
  "${volumes_dir}/worker-hardlinking-ubuntu22-04" \
  "${volumes_dir}/worker-hardlinking-ubuntu22-04/build" \
  "${volumes_dir}/worker-hardlinking-ubuntu22-04/cas" \
  "${volumes_dir}/worker-hardlinking-ubuntu22-04/cas/persistent_state" \
  "${volumes_dir}/worker-integration-test-ubuntu22-04" \
  "${volumes_dir}/worker-integration-test-ubuntu22-04/build" \
  "${volumes_dir}/worker-integration-test-ubuntu22-04/cas" \
  "${volumes_dir}/worker-integration-test-ubuntu22-04/cas/persistent_state"

chmod 0700 \
  "${volumes_dir}/worker-fuse-ubuntu22-04/cache" \
  "${volumes_dir}/worker-hardlinking-ubuntu22-04/cache" \
  "${volumes_dir}/worker-integration-test-ubuntu22-04/cache" \
  "${volumes_dir}/storage-ac-0" \
  "${volumes_dir}/storage-ac-1" \
  "${volumes_dir}/storage-cas-0" \
  "${volumes_dir}/storage-cas-1" \
  "${volumes_dir}/storage-fsac-0" \
  "${volumes_dir}/storage-fsac-1" \
  "${volumes_dir}/storage-ac-0/persistent_state" \
  "${volumes_dir}/storage-ac-1/persistent_state" \
  "${volumes_dir}/storage-cas-0/persistent_state" \
  "${volumes_dir}/storage-cas-1/persistent_state" \
  "${volumes_dir}/storage-fsac-0/persistent_state" \
  "${volumes_dir}/storage-fsac-1/persistent_state"
