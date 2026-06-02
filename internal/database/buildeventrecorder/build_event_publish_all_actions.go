package buildeventrecorder

import (
	"strings"

	"github.com/buildbarn/bb-portal/pkg/invocation"
)

func optionEnablesBuildEventPublishAllActions(option string) *bool {
	option = strings.TrimSpace(option)
	if option == "--build_event_publish_all_actions" {
		enabled := true
		return &enabled
	}
	if option == "--nobuild_event_publish_all_actions" {
		enabled := false
		return &enabled
	}
	if strings.HasPrefix(option, "--build_event_publish_all_actions=") {
		value := strings.TrimPrefix(option, "--build_event_publish_all_actions=")
		enabled := value == "1" || strings.EqualFold(value, "true") || strings.EqualFold(value, "yes")
		return &enabled
	}
	return nil
}

func commandLineOptionEnablesBuildEventPublishAllActions(option, value string) *bool {
	if option != "build_event_publish_all_actions" {
		return nil
	}
	enabled := value == "" || value == "1" || strings.EqualFold(value, "true") || strings.EqualFold(value, "yes")
	return &enabled
}

func parsedOptionsEnableBuildEventPublishAllActions(options *invocation.ParsedCommandLineOptions) *bool {
	if options == nil {
		return nil
	}
	var enabled *bool
	for _, option := range options.Options {
		if parsed := optionEnablesBuildEventPublishAllActions(option); parsed != nil {
			enabled = parsed
		}
	}
	for _, option := range options.ExplicitOptions {
		if parsed := optionEnablesBuildEventPublishAllActions(option); parsed != nil {
			enabled = parsed
		}
	}
	return enabled
}

func commandLineEnablesBuildEventPublishAllActions(commandLine *invocation.CommandLineData) *bool {
	if commandLine == nil {
		return nil
	}
	var enabled *bool
	for _, option := range commandLine.Options {
		if parsed := commandLineOptionEnablesBuildEventPublishAllActions(option.Option, option.Value); parsed != nil {
			enabled = parsed
		}
	}
	return enabled
}
