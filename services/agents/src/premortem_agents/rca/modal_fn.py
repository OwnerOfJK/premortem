import modal

app = modal.App("premortem-rca")

rca_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "langchain>=0.3.0",
    "langchain-openai>=0.2.0",
    "langfuse>=2.50.0",
)


@app.function(
    image=rca_image,
    secrets=[
        modal.Secret.from_name("openai-secret"),
        modal.Secret.from_name("langfuse-secret"),
    ],
    timeout=120,
)
def run_rca(
    system_prompt: str,
    user_prompt: str,
    incident_id: str,
    tenant_id: str,
) -> dict:
    import json
    import os
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage
    from langfuse.callback import CallbackHandler

    langfuse_handler = CallbackHandler(
        public_key=os.environ.get("LANGFUSE_PUBLIC_KEY", ""),
        secret_key=os.environ.get("LANGFUSE_SECRET_KEY", ""),
        host=os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        session_id=incident_id,
        metadata={"tenant_id": tenant_id},
    )

    llm = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0.2,
        model_kwargs={"response_format": {"type": "json_object"}},
    )

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]

    response = llm.invoke(messages, config={"callbacks": [langfuse_handler]})
    result = json.loads(response.content)

    return {
        "hypothesis": result.get("hypothesis", ""),
        "confidence": float(result.get("confidence", 0.0)),
        "evidence_refs": result.get("evidence_refs", []),
    }
