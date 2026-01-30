from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Kafka
    kafka_brokers: str = "localhost:9092"

    # SQS (LocalStack)
    sqs_endpoint: str = "http://localhost:4566"
    aws_region: str = "us-east-1"
    aws_access_key_id: str = "test"
    aws_secret_access_key: str = "test"

    # OpenAI
    openai_api_key: str = ""

    # Modal
    modal_token_id: str = ""
    modal_token_secret: str = ""

    # Langfuse
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"

    model_config = {"env_prefix": "", "case_sensitive": False}


settings = Settings()
