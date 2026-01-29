set dotenv-load

default:
  @just --list

# Start all infrastructure services
up:
  docker compose up -d
  @echo "Waiting for services to be healthy..."
  @sleep 5
  just create-topics
  just create-queues

# Stop all infrastructure services
down:
  docker compose down

# Run all migrations
migrate: migrate-clickhouse migrate-postgres

# Run ClickHouse migrations
migrate-clickhouse:
  #!/usr/bin/env bash
  set -euo pipefail
  for f in packages/db/clickhouse/migrations/*.sql; do
    echo "Running ClickHouse migration: $f"
    curl -s "http://localhost:8123/" --data-binary @"$f"
  done
  echo "ClickHouse migrations complete."

# Run Postgres migrations
migrate-postgres:
  #!/usr/bin/env bash
  set -euo pipefail
  for f in packages/db/postgres/migrations/*.sql; do
    echo "Running Postgres migration: $f"
    PGPASSWORD=premortem psql -h localhost -U premortem -d premortem -f "$f"
  done
  echo "Postgres migrations complete."

# Create Kafka topics
create-topics:
  bash scripts/create-kafka-topics.sh

# Create SQS queues via LocalStack
create-queues:
  bash scripts/create-sqs-queues.sh

# Seed sample data
seed:
  bash scripts/seed-sentry-event.sh

# Start the API in dev mode
dev-api:
  cd services/api && pnpm dev

# Tail logs from all containers
logs:
  docker compose logs -f
