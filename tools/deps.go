package tools

import (
	// Used by //tools:gqlgen.
	_ "github.com/99designs/gqlgen"
	// Used by //:buildifier.
	_ "github.com/bazelbuild/buildtools/buildifier"
	// Used by //tools:gqlgen.
	_ "github.com/urfave/cli/v2"
	// Used by CI.
	_ "golang.org/x/lint"
	// Used by CI.
	_ "mvdan.cc/gofumpt"
)
