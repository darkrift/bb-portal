load("@rules_shell//shell:sh_test.bzl", "sh_test")

_COMMON_TAGS = [
    "docker",
    "exclusive",
    "external",
]

def docker_compose_test_compat(
        name,
        docker_compose_file,
        docker_compose_test_container,
        local_image_targets = "",
        data = [],
        tags = [],
        size = "large",
        **kwargs):
    local_image_paths = local_image_targets.replace("//", "").replace(":", "/")
    sh_test(
        name = name,
        srcs = ["//test/buildbarn_compose:docker_compose_test.sh"],
        data = data + [docker_compose_file],
        env = {
            "DOCKER_COMPOSE_FILE": "$(location %s)" % docker_compose_file,
            "DOCKER_COMPOSE_TEST_CONTAINER": docker_compose_test_container,
            "EXTRA_DOCKER_COMPOSE_UP_ARGS": "",
            "LOCAL_IMAGE_TARGETS": local_image_paths,
            "WORKSPACE_PATH": ".",
        },
        size = size,
        tags = _COMMON_TAGS + tags,
        **kwargs
    )
