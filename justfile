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

# pool topic and queue creation
create: create-topics create-queues

# Create Kafka topics
create-topics:
  bash scripts/create-kafka-topics.sh

# Create SQS queues via LocalStack
create-queues:
  bash scripts/create-sqs-queues.sh

# Truncate all ClickHouse data (safe for running API)
clean-clickhouse:
  @echo "Truncating ClickHouse tables..."
  curl -sf "http://localhost:8123/?user=${CLICKHOUSE_USER}&password=${CLICKHOUSE_PASSWORD}&database=${CLICKHOUSE_DB}" -d "TRUNCATE TABLE raw_events"
  curl -sf "http://localhost:8123/?user=${CLICKHOUSE_USER}&password=${CLICKHOUSE_PASSWORD}&database=${CLICKHOUSE_DB}" -d "TRUNCATE TABLE error_frequency"
  curl -sf "http://localhost:8123/?user=${CLICKHOUSE_USER}&password=${CLICKHOUSE_PASSWORD}&database=${CLICKHOUSE_DB}" -d "TRUNCATE TABLE error_rate"
  curl -sf "http://localhost:8123/?user=${CLICKHOUSE_USER}&password=${CLICKHOUSE_PASSWORD}&database=${CLICKHOUSE_DB}" -d "TRUNCATE TABLE error_novelty"
  @echo "Done."

# Seed sample data
seed:
  bash scripts/seed-sentry-event.sh

# Remove all build artifacts
clean:
  rm -rf packages/shared/dist packages/shared/tsconfig.tsbuildinfo
  rm -rf services/api/dist services/api/tsconfig.tsbuildinfo

# Build all packages
build: clean
  pnpm -r build

# Start the API in dev mode
api:
  cd services/api && pnpm dev

# Tail logs from all containers
logs:
  docker compose logs -f

#Optimised claude
claude:
    claude --system-prompt "$(cat .claude/system-prompt.md)"

test:
    pnpm --filter @premortem/api test