#!/usr/bin/env bash
set -euo pipefail

KAFKA_CONTAINER=$(docker compose ps -q kafka)

if [ -z "$KAFKA_CONTAINER" ]; then
  echo "Error: Kafka container not running"
  exit 1
fi

TOPICS=("debugging.timeline" "debugging.internal" "debugging.evaluation")

for topic in "${TOPICS[@]}"; do
  echo "Creating topic: $topic"
  docker exec "$KAFKA_CONTAINER" /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server localhost:9092 \
    --create \
    --if-not-exists \
    --topic "$topic" \
    --partitions 3 \
    --replication-factor 1
done

echo "Kafka topics created:"
docker exec "$KAFKA_CONTAINER" /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --list
