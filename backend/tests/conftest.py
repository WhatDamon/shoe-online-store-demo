import os
import sqlite3
from contextlib import closing
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import database
from app.infrastructure.database import make_engine
from app.main import app
from app.seed import seed
from tests.postgres_support import postgres_database


@pytest.fixture(scope="session")
def template(tmp_path_factory):
    path = tmp_path_factory.mktemp("template") / "commerce.db"
    original = settings.database_url
    settings.database_url = f"sqlite:///{path.as_posix()}"
    command.upgrade(Config(str(Path(__file__).parents[1] / "alembic.ini")), "head")
    engine = make_engine(settings.database_url)
    with Session(engine) as db, db.begin():
        seed(db)
    engine.dispose()
    settings.database_url = original
    return path


@pytest.fixture(scope="session")
def snapshot_database():
    def snapshot(source: Path, target: Path) -> None:
        source_uri = f"{source.resolve().as_uri()}?mode=ro"
        with (
            closing(sqlite3.connect(source_uri, uri=True)) as reader,
            closing(sqlite3.connect(target)) as writer,
        ):
            reader.backup(writer)

    return snapshot


@pytest.fixture(
    params=["sqlite", "postgres"] if os.getenv("COMMERCE_TEST_POSTGRES_URL") else ["sqlite"]
)
def commerce_engine(request, template, tmp_path, snapshot_database):
    if request.param == "postgres":
        with postgres_database(os.environ["COMMERCE_TEST_POSTGRES_URL"]) as engine:
            with Session(engine) as db, db.begin():
                seed(db)
            yield engine
        return
    path = tmp_path / "commerce.db"
    snapshot_database(template, path)
    engine = make_engine(f"sqlite:///{path.as_posix()}")
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def commerce(commerce_engine, monkeypatch):
    # API tests use isolated DBs; worker lifecycle has dedicated tests with its own DB.
    monkeypatch.setattr(settings, "reservation_sweeper_enabled", False)
    engine = commerce_engine

    def session():
        with Session(engine) as db, db.begin():
            yield db

    app.dependency_overrides[database] = session
    try:
        with TestClient(app) as client:
            client.headers["X-Session-ID"] = str(uuid4())
            yield client, engine
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def variant(commerce):
    client, _ = commerce
    return client.get("/api/v1/catalog/products/dc-1001").json()["variants"][0]
