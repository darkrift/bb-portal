package schema

import (
	"entgo.io/contrib/entgql"
	"entgo.io/ent"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// TestResultFile holds the schema definition for the TestResultFile entity.
type TestResultFile struct {
	ent.Schema
}

// Fields of the TestResultFile.
func (TestResultFile) Fields() []ent.Field {
	return []ent.Field{
		field.String("name"),
		field.String("uri"),
	}
}

// Annotations of the TestResultFile.
func (TestResultFile) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entgql.RelayConnection(),
	}
}

// Mixin of the TestResultFile.
func (TestResultFile) Mixin() []ent.Mixin {
	return []ent.Mixin{
		Int64IdMixin{},
	}
}
