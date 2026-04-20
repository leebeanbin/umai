"""구조적 JSON 로깅 설정."""
import logging


def configure_logging(debug: bool = False) -> None:
    try:
        from pythonjsonlogger import jsonlogger
        fmt = "%(asctime)s %(levelname)s %(name)s %(message)s"
        handler = logging.StreamHandler()
        handler.setFormatter(jsonlogger.JsonFormatter(fmt))
        logging.root.setLevel(logging.DEBUG if debug else logging.INFO)
        logging.root.handlers = [handler]
    except ImportError:
        logging.basicConfig(
            level=logging.DEBUG if debug else logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
