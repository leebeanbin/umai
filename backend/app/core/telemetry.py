"""OpenTelemetry 설정 — OTEL_ENDPOINT 미설정 시 no-op."""
import logging

logger = logging.getLogger(__name__)


def setup_telemetry(app, db_engine=None) -> None:
    from app.core.config import settings

    if not settings.OTEL_ENDPOINT:
        return

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        provider = TracerProvider(
            resource=Resource({"service.name": "umai-backend"})
        )
        provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.OTEL_ENDPOINT))
        )
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)
        HTTPXClientInstrumentor().instrument()

        if db_engine is not None:
            try:
                from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
                SQLAlchemyInstrumentor().instrument(engine=db_engine)
            except Exception as exc:
                logger.warning("SQLAlchemy OTEL instrumentation skipped: %s", exc)

        logger.info("OpenTelemetry enabled → %s", settings.OTEL_ENDPOINT)
    except ImportError as exc:
        logger.warning("opentelemetry packages not installed, tracing disabled: %s", exc)
