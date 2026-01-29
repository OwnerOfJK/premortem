set dotenv-load

default:
  @just --list

# Start all infrastructure services
up:
  docker compose up
  @echo "Waiting for services to be healthy..."
  @sleep 5

# Stop all infrastructure services
down:
  docker compose down

# Run all migrations
migrate: migrate-clickhouse migrate-postgres

# Run ClickHouse migrations
migrate-clickhouse:
  migrate -path packages/db/clickhouse/migrations \
    -database "clickhouse://localhost:9000?username=${CLICKHOUSE_USER}&password=${CLICKHOUSE_PASSWORD}&database=${CLICKHOUSE_DB}" up

# Run Postgres migrations
migrate-postgres:
  migrate -path packages/db/postgres/migrations \
    -database "postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=disable" up

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

#Optimised claude
claude:
    claude --system-prompt "$(cat .claude/system-prompt.md)"