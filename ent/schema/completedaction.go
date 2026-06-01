package schema

import (
	"time"

	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// CompletedAction holds the schema definition for a remote execution action
// reported through Buildbarn's CompletedActionLogger service.
type CompletedAction struct {
	ent.Schema
}

// Fields of the CompletedAction.
func (CompletedAction) Fields() []ent.Field {
	return []ent.Field{
		field.String("uuid").
			Unique().
			Immutable(),
		field.String("instance_name").
			Immutable(),
		field.String("action_digest_hash").
			Immutable(),
		field.Int64("action_digest_size_bytes").
			Immutable(),
		field.String("digest_function").
			Optional().
			Immutable(),

		field.String("tool_invocation_id").
			Optional(),
		field.String("correlated_invocations_id").
			Optional(),
		field.String("target_id").
			Optional(),
		field.String("action_mnemonic").
			Optional(),

		field.Bool("cache_hit").
			Optional(),
		field.Int32("exit_code").
			Optional(),
		field.Int32("status_code").
			Optional(),
		field.String("status_message").
			Optional(),

		field.Time("queued_at").
			Optional(),
		field.Time("worker_start_at").
			Optional(),
		field.Time("worker_completed_at").
			Optional(),
		field.Time("uploaded_at").
			Default(time.Now).
			Immutable(),

		field.String("stdout_hash").Optional(),
		field.Int64("stdout_size_bytes").Optional(),
		field.String("stderr_hash").Optional(),
		field.Int64("stderr_size_bytes").Optional(),

		field.Bytes("historical_execute_response").
			Optional().
			Sensitive().
			Annotations(
				entgql.Skip(),
			),
	}
}

// Edges of the CompletedAction.
func (CompletedAction) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("bazel_invocation", BazelInvocation.Type).
			Ref("completed_actions").
			Unique(),
		edge.From("action", Action.Type).
			Ref("completed_actions").
			Unique(),
	}
}

// Indexes of the CompletedAction.
func (CompletedAction) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("instance_name", "action_digest_hash", "action_digest_size_bytes", "digest_function"),
		index.Fields("tool_invocation_id"),
		index.Fields("target_id"),
		index.Edges("bazel_invocation"),
		index.Edges("action"),
	}
}

// Annotations of the CompletedAction.
func (CompletedAction) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "completed_actions"},
	}
}

// Mixin of the CompletedAction.
func (CompletedAction) Mixin() []ent.Mixin {
	return []ent.Mixin{
		Int64IdMixin{},
	}
}
