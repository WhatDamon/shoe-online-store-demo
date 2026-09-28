import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.v1.routes import DB, router
from app.application.errors import CommerceError
from app.application.expiry import expiry_loop
from app.config import settings

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


app = FastAPI(title="Evoloop local commerce", version="0.1.0", lifespan=lifespan)
app.include_router(router)


@app.exception_handler(CommerceError)
async def commerce_error(_request: Request, exc: CommerceError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "detail": exc.message},
    )


@app.middleware("http")
async def request_log(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    start = time.monotonic()
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    logger.info(
        json.dumps(
            dict(
                event="request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                elapsed_ms=round((time.monotonic() - start) * 1000),
            )
        )
    )
    return response


@app.get("/health")
def health(db: DB) -> dict:
    db.execute(text("SELECT version_num FROM alembic_version"))
    return {"status": "ok", "payment_enabled": False}
