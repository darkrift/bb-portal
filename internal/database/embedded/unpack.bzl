"""Rule to unpack a .tar.xz and make it available as a directory."""

def _unpack_impl(ctx):
    input_tar = ctx.file.src
    output_dir = ctx.actions.declare_directory(ctx.attr.name + ".extracted")
    args = ctx.actions.args()
    args.add_all([
        input_tar.path,
        output_dir.path,
    ])
    ctx.actions.run_shell(
        inputs = [input_tar],
        outputs = [output_dir],
        arguments = [args],
        command = """
        input=$1
        output=$2
        tar -xJf "$input" -C "$output"
        """
    )
    return [DefaultInfo(files = depset([output_dir]))]


unpack = rule(
    implementation = _unpack_impl,
    attrs = {
        "src": attr.label(allow_single_file = True, mandatory = True),
    },
)
