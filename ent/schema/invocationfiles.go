package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// InvocationFiles holds the schema definition for the InvocationFiles entity.
type InvocationFiles struct {
	ent.Schema
}

// Fields of the InvocationFiles.
func (InvocationFiles) Fields() []ent.Field {
	return []ent.Field{
		// Name of the file, including path relative to the invocation root.
		field.String("name"),

		// Uri of the file, if available.
		field.String("uri").Optional(),

		// Content of the file, if available.
		field.String("content").Optional(),

		// Digest of the file, if available.
		field.String("digest").Optional(),

		// SizeBytes is the size of the file in bytes, if available.
		field.Int64("size_bytes").Optional(),

		// DigestFunction is the function used to compute the digest, in lower case. Defaults to "sha256".
		field.String("digest_function").Optional(),
	}
}

// Edges of the InvocationFiles.
func (InvocationFiles) Edges() []ent.Edge {
	return []ent.Edge{
		// Edge back to the bazel invocation.
		edge.From("bazel_invocation", BazelInvocation.Type).
			Ref("invocation_files").
			Unique(),

		// Edge back to the action that produced this file.
		edge.From("action", Action.Type).
			Ref("action_files").
			Unique(),

		// Edge back to the completed invocation target that produced this file.
		edge.From("invocation_target", InvocationTarget.Type).
			Ref("target_files").
			Unique(),
	}
}

// Indexes of the InvocationFiles.
func (InvocationFiles) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("bazel_invocation"),
		// Index making the combination of a name and invocation unique.
		index.Fields("name").
			Edges("bazel_invocation").
			Unique(),
		index.Edges("action"),
		index.Fields("name").
			Edges("action").
			Unique(),
		index.Edges("invocation_target"),
		index.Fields("name").
			Edges("invocation_target").
			Unique(),
	}
}

// Annotations of the InvocationFiles.
func (InvocationFiles) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
	}
}

// Mixin of the InvocationFiles.
func (InvocationFiles) Mixin() []ent.Mixin {
	return []ent.Mixin{
		Int64IdMixin{},
	}
}
