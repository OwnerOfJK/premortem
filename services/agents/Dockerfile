FROM python:3.11-slim

# Install librdkafka for confluent-kafka
RUN apt-get update && \
    apt-get install -y --no-install-recommends librdkafka-dev gcc && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
COPY src/ src/

RUN pip install --no-cache-dir .

CMD ["premortem-agents"]
