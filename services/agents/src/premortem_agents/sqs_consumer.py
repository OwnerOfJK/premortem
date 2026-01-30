import json
import signal
import logging
from collections.abc import Callable
from typing import Any

import boto3

from .config import settings

logger = logging.getLogger(__name__)


def poll_sqs(
    queue_name: str,
    handler: Callable[[dict[str, Any]], None],
    *,
    wait_time_seconds: int = 5,
    max_messages: int = 10,
) -> None:
    """Blocking SQS poll loop with graceful shutdown on SIGTERM/SIGINT."""
    running = True

    def _stop(signum: int, _frame: Any) -> None:
        nonlocal running
        logger.info("Received signal %s, shutting down consumer...", signum)
        running = False

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    client = boto3.client(
        "sqs",
        region_name=settings.aws_region,
        endpoint_url=settings.sqs_endpoint,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )

    queue_url = client.get_queue_url(QueueName=queue_name)["QueueUrl"]
    logger.info("Polling SQS queue: %s (%s)", queue_name, queue_url)

    while running:
        try:
            response = client.receive_message(
                QueueUrl=queue_url,
                MaxNumberOfMessages=max_messages,
                WaitTimeSeconds=wait_time_seconds,
            )
        except Exception:
            logger.exception("Error receiving SQS messages")
            continue

        messages = response.get("Messages", [])
        for message in messages:
            try:
                body = json.loads(message["Body"])
                handler(body)
            except Exception:
                logger.exception("Handler failed for message %s", message.get("MessageId"))
                continue

            try:
                client.delete_message(
                    QueueUrl=queue_url,
                    ReceiptHandle=message["ReceiptHandle"],
                )
            except Exception:
                logger.exception("Failed to delete message %s", message.get("MessageId"))

    logger.info("SQS consumer stopped")
