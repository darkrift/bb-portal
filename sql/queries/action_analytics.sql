-- name: ClaimActionAnalytics :one
WITH candidate AS (
    SELECT id
    FROM bazel_invocations
    WHERE bep_completed = true
      AND (
        action_analytics_state = 'PENDING'
        OR (
          action_analytics_state = 'PROCESSING'
          AND (
            action_analytics_started_at IS NULL
            OR action_analytics_started_at < sqlc.arg(stale_before)::timestamptz
          )
        )
      )
    ORDER BY ended_at NULLS LAST, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE bazel_invocations AS invocation
SET action_analytics_state = 'PROCESSING',
    action_analytics_started_at = NOW(),
    action_analytics_completed_at = NULL,
    action_analytics_failure_message = NULL,
    action_analytics_result = NULL
FROM candidate
WHERE invocation.id = candidate.id
RETURNING invocation.id;
