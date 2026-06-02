package graphql

import (
	"context"
	"fmt"

	"github.com/99designs/gqlgen/graphql"
	"github.com/buildbarn/bb-portal/ent/gen/ent"
	"github.com/buildbarn/bb-portal/internal/database"
	"github.com/buildbarn/bb-portal/internal/graphql/helpers"
)

// This file will not be regenerated automatically.
//
// It serves as dependency injection for your app, add any dependencies you require here.

// The Resolver Type for DI
type Resolver struct {
	db database.Client
}

// NewSchema creates a graphql executable schema.
func NewSchema(db database.Client) graphql.ExecutableSchema {
	return NewExecutableSchema(Config{
		Resolvers: &Resolver{db: db},
	})
}

func targetLabelForID(ctx context.Context, client *ent.Client, targetID string) (string, error) {
	targetType, targetDBID, err := helpers.GraphQLTypeAndIntIDFromID(targetID)
	if err != nil {
		return "", err
	}
	if targetType != "Target" {
		return "", fmt.Errorf("expected Target ID, got %s", targetType)
	}
	targetNode, err := client.Target.Get(ctx, targetDBID)
	if err != nil {
		return "", err
	}
	return targetNode.Label, nil
}
