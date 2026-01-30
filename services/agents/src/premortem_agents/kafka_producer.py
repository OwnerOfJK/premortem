import json
from confluent_kafka import Producer

from .config import settings

TOPIC = "debugging.timeline"

_producer: Producer | None = None


def get_producer() -> Producer:
    global _producer
    if _producer is None:
        _producer = Producer({"bootstrap.servers": settings.kafka_brokers})
    return _producer


def produce_timeline_event(event: dict) -> None:
    producer = get_producer()
    producer.produce(
        topic=TOPIC,
        key=event["incident_id"],
        value=json.dumps(event).encode(),
    )
    producer.flush()


def disconnect_producer() -> None:
    global _producer
    if _producer is not None:
        _producer.flush()
        _producer = None
