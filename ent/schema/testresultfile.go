package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// TestResultFile holds the schema definition for files produced by a test
// result attempt.
type TestResultFile struct {
	ent.Schema
}

// Fields of the TestResultFile.
func (TestResultFile) Fields() []ent.Field {
	return []ent.Field{
		// Name of the file as reported by Bazel, e.g. "test.log".
		field.String("name"),

		// URI of the file as reported by Bazel.
		field.String("uri"),
	}
}

// Edges of the TestResultFile.
func (TestResultFile) Edges() []ent.Edge {
	return []ent.Edge{
		// Edge back to the originating test result.
		edge.From("test_result", TestResult.Type).
			Ref("test_result_files").
			Unique(),
	}
}

// Indexes of the TestResultFile.
func (TestResultFile) Indexes() []ent.Index {
	return []ent.Index{
		index.Edges("test_result"),
		index.Fields("name").
			Edges("test_result").
			Unique(),
	}
}

// Mixin of the TestResultFile.
func (TestResultFile) Mixin() []ent.Mixin {
	return []ent.Mixin{
		Int64IdMixin{},
	}
}
