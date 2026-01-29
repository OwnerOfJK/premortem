#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3000}"

echo "==> Sending mock Sentry issue alert webhook to $API_URL/webhooks/sentry"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/webhooks/sentry" \
  -H "Content-Type: application/json" \
  -d '{
  "action": "created",
  "data": {
    "event": {
      "event_id": "a]b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
      "project": "my-api",
      "platform": "node",
      "level": "error",
      "timestamp": 1706450096.123,
      "environment": "production",
      "title": "TypeError: Cannot read properties of undefined",
      "culprit": "app/services/user.ts in getUserProfile",
      "message": "",
      "tags": [
        ["service", "user-service"],
        ["release", "abc123def"],
        ["environment", "production"],
        ["url", "/api/users/42/profile"]
      ],
      "exception": {
        "values": [
          {
            "type": "TypeError",
            "value": "Cannot read properties of undefined (reading '\''email'\'')",
            "stacktrace": {
              "frames": [
                {
                  "filename": "node_modules/express/lib/router/layer.js",
                  "function": "Layer.handle",
                  "lineno": 95,
                  "colno": 5,
                  "in_app": false
                },
                {
                  "filename": "node_modules/express/lib/router/route.js",
                  "function": "Route.dispatch",
                  "lineno": 114,
                  "colno": 3,
                  "in_app": false
                },
                {
                  "filename": "app/middleware/auth.ts",
                  "function": "authenticate",
                  "lineno": 23,
                  "colno": 12,
                  "in_app": true
                },
                {
                  "filename": "app/services/user.ts",
                  "function": "getUserProfile",
                  "lineno": 47,
                  "colno": 22,
                  "in_app": true,
                  "context_line": "    const email = user.profile.email;"
                },
                {
                  "filename": "app/routes/users.ts",
                  "function": "handleGetProfile",
                  "lineno": 31,
                  "colno": 18,
                  "in_app": true
                }
              ]
            }
          }
        ]
      }
    }
  },
  "project": {
    "slug": "my-api",
    "name": "My API"
  }
}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$ d')

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Expected HTTP 200, got $HTTP_CODE"
  exit 1
fi

echo ""
echo "==> Verifying ClickHouse insertion..."
sleep 3

RESULT=$(curl -s "http://localhost:8123/?user=${CLICKHOUSE_USER}&password=${CLICKHOUSE_PASSWORD}&database=${CLICKHOUSE_DB}" \
  --data "SELECT event_id, error_type, error_signature, service, environment FROM raw_events FORMAT Pretty")

if [ -z "$RESULT" ]; then
  echo "ERROR: No rows found in raw_events after insert"
  exit 1
else
  echo "raw_events:"
  echo "$RESULT"
fi

echo ""
echo "==> Checking error_frequency materialized view..."
FREQ=$(curl -s "http://localhost:8123/?user=${CLICKHOUSE_USER}&password=${CLICKHOUSE_PASSWORD}&database=${CLICKHOUSE_DB}" \
  --data "SELECT * FROM error_frequency FORMAT Pretty")
echo "${FREQ:-No rows yet}"

echo ""
echo "==> Checking error_rate materialized view..."
RATE=$(curl -s "http://localhost:8123/?user=${CLICKHOUSE_USER}&password=${CLICKHOUSE_PASSWORD}&database=${CLICKHOUSE_DB}" \
  --data "SELECT * FROM error_rate FORMAT Pretty")
echo "${RATE:-No rows yet}"

echo ""
echo "==> Seed complete."
