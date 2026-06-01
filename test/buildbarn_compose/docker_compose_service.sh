#!/usr/bin/env bash

set -euo pipefail

HTTP_PORT=""
BES_PORT=""
FRONTEND_PORT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --http-port)
            HTTP_PORT="$2"
            shift 2
            ;;
        --bes-port)
            BES_PORT="$2"
            shift 2
            ;;
        --frontend-port)
            FRONTEND_PORT="$2"
            shift 2
            ;;
        *)
            echo "unknown argument: $1" >&2
            exit 2
            ;;
    esac
done

if [[ -z "$HTTP_PORT" || -z "$BES_PORT" || -z "$FRONTEND_PORT" ]]; then
    echo "missing required port arguments" >&2
    exit 2
fi

rlocation() {
    local path="$1"
    if [[ -e "$path" ]]; then
        printf '%s\n' "$path"
        return 0
    fi
    if [[ -n "${RUNFILES_DIR:-}" && -e "$RUNFILES_DIR/$path" ]]; then
        printf '%s\n' "$RUNFILES_DIR/$path"
        return 0
    fi
    if [[ -n "${RUNFILES_DIR:-}" && -n "${TEST_WORKSPACE:-}" && -e "$RUNFILES_DIR/$TEST_WORKSPACE/$path" ]]; then
        printf '%s\n' "$RUNFILES_DIR/$TEST_WORKSPACE/$path"
        return 0
    fi
    if [[ -n "${RUNFILES_DIR:-}" && -e "$RUNFILES_DIR/com_github_buildbarn_bb_portal/$path" ]]; then
        printf '%s\n' "$RUNFILES_DIR/com_github_buildbarn_bb_portal/$path"
        return 0
    fi
    return 1
}

run_image_loader() {
    local base="cmd/bb_portal/bb_portal_container_load"
    local candidate
    for suffix in ".sh" ".executable" ".exe" ""; do
        if candidate="$(rlocation "$base$suffix" 2>/dev/null)" && [[ -x "$candidate" ]]; then
            "$candidate"
            return 0
        fi
    done
    echo "failed to locate bb_portal_container_load in runfiles" >&2
    return 1
}

compose_cmd=(docker compose)
if command -v docker-compose >/dev/null 2>&1; then
    compose_cmd=(docker-compose)
fi

source_compose="$(rlocation "test/buildbarn_compose/docker-compose.yml")"
source_dir="$(cd "$(dirname "$source_compose")" && pwd)"
fixture_dir="$(mktemp -d "${TEST_TMPDIR:-/tmp}/bb-portal-buildbarn-compose.XXXXXX")"
export COMPOSE_FIXTURE_DIR="$fixture_dir"

cleanup() {
    set +e
    "${compose_cmd[@]}" -f "$fixture_dir/docker-compose.yml" -f "$fixture_dir/ports.yml" logs --no-color
    "${compose_cmd[@]}" -f "$fixture_dir/docker-compose.yml" -f "$fixture_dir/ports.yml" down --volumes --remove-orphans
    rm -rf "$fixture_dir"
}
trap cleanup EXIT INT TERM

run_image_loader

cp -L "$source_compose" "$fixture_dir/docker-compose.yml"
mkdir -p "$fixture_dir/config"
cp -L "$source_dir"/config/* "$fixture_dir/config/"

cat >"$fixture_dir/ports.yml" <<EOF
services:
  bb-portal:
    ports:
      - "127.0.0.1:${HTTP_PORT}:8080"
      - "127.0.0.1:${BES_PORT}:8981"
  frontend:
    ports:
      - "127.0.0.1:${FRONTEND_PORT}:8980"
EOF

exec "${compose_cmd[@]}" -f "$fixture_dir/docker-compose.yml" -f "$fixture_dir/ports.yml" up
