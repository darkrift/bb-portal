package buildeventrecorder

import (
	"context"

	bes "github.com/bazelbuild/bazel/src/main/java/com/google/devtools/build/lib/buildeventstream/proto"
	"github.com/buildbarn/bb-portal/ent/gen/ent"
	"github.com/buildbarn/bb-portal/pkg/invocation"
	"github.com/buildbarn/bb-storage/pkg/util"
)

func (r *buildEventRecorder) saveOptionsParsed(ctx context.Context, tx *ent.Client, optionsParsed *bes.OptionsParsed) error {
	if optionsParsed == nil {
		return nil
	}
	parsedOptions := &invocation.ParsedCommandLineOptions{
		ExplicitOptions: optionsParsed.ExplicitCmdLine,
		Options:         optionsParsed.CmdLine,
	}
	update := tx.BazelInvocation.
		UpdateOneID(r.InvocationDbID).
		SetOptionsParsed(parsedOptions)
	if enabled := parsedOptionsEnableBuildEventPublishAllActions(parsedOptions); enabled != nil {
		update.SetBuildEventPublishAllActions(*enabled)
	}
	err := update.Exec(ctx)
	if err != nil {
		return util.StatusWrap(err, "Could not parse options")
	}
	return nil
}
