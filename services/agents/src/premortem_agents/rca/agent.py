import logging
from datetime import datetime, timezone
from typing import Any

import modal

from ..kafka_producer import produce_timeline_event
from .prompts import SYSTEM_PROMPT, USER_PROMPT_TEMPLATE

logger = logging.getLogger(__name__)


def handle_context_built(event: dict[str, Any]) -> None:
    """Process a ContextBuiltEvent: run RCA via Modal, emit RootCauseProposedEvent."""
    tenant_id = event["tenant_id"]
    incident_id = event["incident_id"]
    context_summary = event["payload"]["context_summary"]

    logger.info("Running RCA for incident %s", incident_id)

    user_prompt = USER_PROMPT_TEMPLATE.format(context_summary=context_summary)

    # Call Modal function remotely
    run_rca = modal.Function.from_name("premortem-rca", "run_rca")
    result = run_rca.remote(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        incident_id=incident_id,
        tenant_id=tenant_id,
    )

    # Construct RootCauseProposedEvent
    rca_event = {
        "time": datetime.now(timezone.utc).isoformat(),
        "tenant_id": tenant_id,
        "incident_id": incident_id,
        "event_type": "RootCauseProposed",
        "payload": {
            "hypothesis": result["hypothesis"],
            "confidence": result["confidence"],
            "evidence_refs": result["evidence_refs"],
        },
    }

    produce_timeline_event(rca_event)
    logger.info(
        "RCA complete for incident %s (confidence=%.2f)",
        incident_id,
        result["confidence"],
    )
