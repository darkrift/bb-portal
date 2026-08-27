package actionanalyticsservice_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	_ "github.com/buildbarn/bb-portal/ent/gen/ent/runtime"
	"github.com/buildbarn/bb-portal/internal/database/actionanalyticsservice"
	"github.com/buildbarn/bb-portal/internal/database/dbauthservice"
	"github.com/buildbarn/bb-portal/internal/database/embedded"
	"github.com/buildbarn/bb-portal/pkg/invocation/actionanalytics"
	"github.com/buildbarn/bb-portal/test/testutils"
	"github.com/buildbarn/bb-storage/pkg/clock"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/trace/noop"
)

var dbProvider *embedded.DatabaseProvider

func TestMain(m *testing.M) {
	var err error
	dbProvider, err = embedded.NewDatabaseProvider(os.Stderr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Could not start embedded DB: %v\n", err)
		os.Exit(1)
	}
	defer dbProvider.Cleanup()
	m.Run()
}

func TestProcessNextOnlyProcessesCompletedInvocations(t *testing.T) {
	ctx := dbauthservice.NewContextWithDbAuthServiceBypass(context.Background())
	db := testutils.SetupTestDB(t, dbProvider)
	client := db.Ent()
	instanceName := testutils.CreateInstanceName(ctx, t, client, "testInstance")

	incompleteInvocation, err := testutils.StartCreateInvocation(client, instanceName).
		SetBepCompleted(false).
		Save(ctx)
	require.NoError(t, err)

	completedInvocation, err := testutils.StartCreateInvocation(client, instanceName).
		SetBepCompleted(true).
		SetEndedAt(time.Unix(20, 0)).
		Save(ctx)
	require.NoError(t, err)

	actionStart := time.Unix(10, 0)
	_, err = client.ActionExecution.Create().
		SetBazelInvocation(completedInvocation).
		SetLabel("//example:compile").
		SetType("CppCompile").
		SetRunner("remote").
		SetCacheHit(false).
		SetStartTime(actionStart).
		SetEndTime(actionStart.Add(5 * time.Second)).
		SetSpawnTotalTimeInMs(4500).
		SetSpawnQueueTimeInMs(1500).
		SetSpawnExecutionWallTimeInMs(2500).
		SetExecutionPlatform(map[string]string{"cpu": "x86_64"}).
		Save(ctx)
	require.NoError(t, err)

	service := actionanalyticsservice.New(db, clock.SystemClock, noop.NewTracerProvider())
	processed, err := service.ProcessNext(ctx)
	require.NoError(t, err)
	require.True(t, processed)

	completedInvocation, err = client.BazelInvocation.Get(ctx, completedInvocation.ID)
	require.NoError(t, err)
	require.Equal(t, string(actionanalytics.StateCompleted), string(completedInvocation.ActionAnalyticsState))
	require.NotNil(t, completedInvocation.ActionAnalyticsStartedAt)
	require.NotNil(t, completedInvocation.ActionAnalyticsCompletedAt)
	require.NotNil(t, completedInvocation.ActionAnalyticsResult)
	require.EqualValues(t, 1, completedInvocation.ActionAnalyticsResult.TotalActions)
	require.EqualValues(t, 1, completedInvocation.ActionAnalyticsResult.RemoteExecutionActions)
	require.EqualValues(t, 1500, completedInvocation.ActionAnalyticsResult.RemoteQueueTime.P95InMs)

	incompleteInvocation, err = client.BazelInvocation.Get(ctx, incompleteInvocation.ID)
	require.NoError(t, err)
	require.Equal(t, string(actionanalytics.StatePending), string(incompleteInvocation.ActionAnalyticsState))
	require.Nil(t, incompleteInvocation.ActionAnalyticsResult)

	processed, err = service.ProcessNext(ctx)
	require.NoError(t, err)
	require.False(t, processed)
}
