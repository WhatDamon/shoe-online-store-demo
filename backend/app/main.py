import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException

from app.api.v1.routes import DB, router
from app.application.errors import CommerceError
from app.application.expiry import expiry_loop
from app.config import settings
from app.schemas.responses import ErrorResponse, HealthResponse

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("commerce")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    stop = asyncio.Event()
    task = asyncio.create_task(expiry_loop(stop)) if settings.reservation_sweeper_enabled else None
    try:
        yield
    finally:
        stop.set()
        if task is not None:
            await task  # Finish the current transaction before shutdown, never abandon a write.


app = FastAPI(
    title="Evoloop local commerce",
    version="0.1.0",
    lifespan=lifespan,
    responses={
        status: {"model": ErrorResponse} for status in (400, 401, 403, 404, 405, 409, 422, 500, 503)
    },
)
app.include_router(router)


def error_response(request: Request, status: int, code: str, detail: str) -> JSONResponse:
    request.state.error_code = code
    return JSONResponse(
        status_code=status, content=ErrorResponse(code=code, detail=detail).model_dump()
    )


@app.exception_handler(CommerceError)
async def commerce_error(request: Request, exc: CommerceError) -> JSONResponse:
    return error_response(request, exc.status_code, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, _exc: RequestValidationError) -> JSONResponse:
    # Pydantic errors can contain the original body, session header or rejected value.
    return error_response(request, 422, "invalid_request", "Request validation failed")


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    code, detail = {
        400: ("bad_request", "Invalid request"),
        401: ("unauthorized", "Authentication required"),
        403: ("forbidden", "Request not allowed"),
        404: ("not_found", "Resource not found"),
        405: ("method_not_allowed", "Method not allowed"),
        409: ("conflict", "Request conflicts with current state"),
        422: ("invalid_request", "Request validation failed"),
        503: ("service_unavailable", "Service temporarily unavailable"),
    }.get(exc.status_code, ("internal_error", "Request could not be completed"))
    response = error_response(request, exc.status_code, code, detail)
    if exc.status_code == 405 and exc.headers and "Allow" in exc.headers:
        response.headers["Allow"] = exc.headers["Allow"]
    return response


def request_id(value: str | None) -> str:
    # The internal Next proxy supplies this ID. It is correlation data, never authority.
    if value and len(value) == 36:
        try:
            parsed = UUID(value)
            if parsed.version == 4:
                return str(parsed)
        except ValueError:
            pass
    return str(uuid4())


@app.middleware("http")
async def request_log(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    start = time.monotonic()
    trace_id = request_id(request.headers.get("x-request-id"))
    try:
        response = await call_next(request)
    except Exception:
        # Function-scoped DB dependencies have unwound/rolled back before this catch.
        # Do not rethrow to the server logger, which would print private exception text.
        response = error_response(request, 500, "internal_error", "Request could not be completed")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Request-ID"] = trace_id
    route = request.scope.get("route")
    logger.info(
        json.dumps(
            dict(
                event="request",
                request_id=trace_id,
                method=request.method,
                route=getattr(route, "path", "<unmatched>"),
                status=response.status_code,
                code=getattr(request.state, "error_code", "ok"),
                elapsed_ms=round((time.monotonic() - start) * 1000),
            )
        )
    )
    return response


@app.get("/health", response_model=HealthResponse)
def health(db: DB) -> dict:
    db.execute(text("SELECT version_num FROM alembic_version"))
    return {"status": "ok", "payment_enabled": False}
