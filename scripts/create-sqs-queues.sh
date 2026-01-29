#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="http://localhost:4566"
REGION="us-east-1"

QUEUES=(
  "context-builder-tasks"
  "rca-tasks"
  "fix-tasks"
  "instrumentation-tasks"
  "evaluation-tasks"
)

for queue in "${QUEUES[@]}"; do
  echo "Creating SQS queue: $queue"
  aws --endpoint-url="$ENDPOINT" --region="$REGION" \
    sqs create-queue --queue-name "$queue" \
    --no-cli-pager 2>/dev/null || true
done

echo ""
echo "SQS queues created:"
aws --endpoint-url="$ENDPOINT" --region="$REGION" \
  sqs list-queues --no-cli-pager 2>/dev/null || echo "(list failed — LocalStack may still be starting)"
