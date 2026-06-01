#!/usr/bin/env bash

# Compatibility wrapper for rules_docker_compose_test on Bazel versions where
# image_load executables are emitted as .exe files.

export IFS=","
echo "$LOCAL_IMAGE_TARGETS"
for LOCAL_IMAGE_TARGET in $LOCAL_IMAGE_TARGETS; do
    if [ -f "$LOCAL_IMAGE_TARGET.sh" ]; then
        "$LOCAL_IMAGE_TARGET.sh"
    elif [ -f "$LOCAL_IMAGE_TARGET.executable" ]; then
        "$LOCAL_IMAGE_TARGET.executable"
    elif [ -f "$LOCAL_IMAGE_TARGET.exe" ]; then
        "$LOCAL_IMAGE_TARGET.exe"
    else
        echo "[ERROR] no install script present for $LOCAL_IMAGE_TARGET"
        exit 1
    fi
done

SOURCE_COMPOSE_FILE_PATH="$WORKSPACE_PATH/$DOCKER_COMPOSE_FILE"
SOURCE_FIXTURE_DIR="$(cd "$(dirname "$SOURCE_COMPOSE_FILE_PATH")" && pwd)"
COMPOSE_FIXTURE_DIR="$(mktemp -d "${TEST_TMPDIR:-/tmp}/bb-portal-compose.XXXXXX")"
export COMPOSE_FIXTURE_DIR
cp -L "$SOURCE_COMPOSE_FILE_PATH" "$COMPOSE_FIXTURE_DIR/docker-compose.yml"
mkdir -p "$COMPOSE_FIXTURE_DIR/config"
cp -L "$SOURCE_FIXTURE_DIR"/config/* "$COMPOSE_FIXTURE_DIR/config/"
ABSOLUTE_COMPOSE_FILE_PATH="$COMPOSE_FIXTURE_DIR/docker-compose.yml"

docker_compose_bin=(docker compose)
if command -v docker-compose &>/dev/null; then
    docker_compose_bin=(docker-compose)
fi

cleanup() {
    echo "Cleaning up docker-compose resources..."
    docker_compose_down_cmd=("${docker_compose_bin[@]}" -f "$ABSOLUTE_COMPOSE_FILE_PATH" down --volumes --remove-orphans)
    echo "running: ${docker_compose_down_cmd[@]}"
    "${docker_compose_down_cmd[@]}"
    rm -rf "$COMPOSE_FIXTURE_DIR"
}

trap cleanup EXIT

docker_compose_up_cmd=(
    "${docker_compose_bin[@]}"
    "-f" "$ABSOLUTE_COMPOSE_FILE_PATH"
    "up"
    "-d"
)
if [ -n "$EXTRA_DOCKER_COMPOSE_UP_ARGS" ]; then
    IFS=' ' read -r -a extra_args <<< "$EXTRA_DOCKER_COMPOSE_UP_ARGS"
    docker_compose_up_cmd+=("${extra_args[@]}")
fi

echo "running: ${docker_compose_up_cmd[@]}"
if ! "${docker_compose_up_cmd[@]}"; then
    "${docker_compose_bin[@]}" -f "$ABSOLUTE_COMPOSE_FILE_PATH" logs --no-color
    exit 1
fi

SERVICE="$DOCKER_COMPOSE_TEST_CONTAINER"
CID=""
for _ in $(seq 1 60); do
    CID="$("${docker_compose_bin[@]}" -f "$ABSOLUTE_COMPOSE_FILE_PATH" ps -a -q "$SERVICE" 2>/dev/null | head -n 1)" || CID=""
    CID="${CID//$'\r'/}"
    CID="${CID//[[:space:]]/}"
    [ -n "$CID" ] && break
    sleep 1
done
[ -n "$CID" ] || {
    "${docker_compose_bin[@]}" -f "$ABSOLUTE_COMPOSE_FILE_PATH" logs --no-color
    echo "FAIL ($SERVICE container was not created)" >&2
    exit 1
}

docker wait "$CID" >/dev/null

"${docker_compose_bin[@]}" -f "$ABSOLUTE_COMPOSE_FILE_PATH" logs --no-color

CID="$("${docker_compose_bin[@]}" -f "$ABSOLUTE_COMPOSE_FILE_PATH" ps -a -q "$SERVICE" 2>/dev/null | head -n 1)" || CID=""
CID="${CID//$'\r'/}"
CID="${CID//[[:space:]]/}"

EXIT_CODE="$(
    [ -n "$CID" ] && docker inspect "$CID" --format '{{.State.ExitCode}}' 2>/dev/null || echo ""
)"
STATUS="$(
    [ -n "$CID" ] && docker inspect "$CID" --format '{{.State.Status}}' 2>/dev/null || echo "not-found"
)"

if [ "$STATUS" = "exited" ] && [ "$EXIT_CODE" -eq 0 ] 2>/dev/null; then
    echo "PASS ($SERVICE container exit 0)"
    exit 0
fi

echo "FAIL ($SERVICE status=$STATUS exit_code=${EXIT_CODE:-none} cid=${CID:-none})" >&2
exit 1
