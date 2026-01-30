import logging

from .rca.consumer import start_rca_consumer


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger = logging.getLogger(__name__)
    logger.info("Starting premortem agents service")
    start_rca_consumer()


if __name__ == "__main__":
    main()
