import logging

from ..sqs_consumer import poll_sqs
from .agent import handle_context_built

logger = logging.getLogger(__name__)

RCA_QUEUE = "rca-tasks"


def start_rca_consumer() -> None:
    """Start the RCA consumer polling rca-tasks SQS queue."""
    logger.info("Starting RCA consumer on queue: %s", RCA_QUEUE)
    poll_sqs(RCA_QUEUE, handle_context_built)
