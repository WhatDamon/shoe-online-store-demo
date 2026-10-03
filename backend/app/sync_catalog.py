"""python -m app.sync_catalog --catalog data/catalog.json (dry-run by default)."""

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.application.catalog_sync import CatalogSyncError, apply_availability, plan_availability
from app.config import settings
from app.domain.catalog_identity import CatalogIdentity
from app.infrastructure.database import make_engine
from app.schemas.catalog_snapshot import snapshot_adapter


def unique_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise CatalogSyncError("Duplicate JSON field in snapshot")
        result[key] = value
    return result


def load_snapshot(path: Path) -> list[CatalogIdentity]:
    with path.open("rb") as stream:
        data = stream.read(2_000_001)
    if len(data) > 2_000_000:
        raise CatalogSyncError("Snapshot exceeds 2 MB limit")
    return [
        p.identity()
        for p in snapshot_adapter.validate_python(json.loads(data, object_pairs_hook=unique_object))
    ]


def sync_engine(url: str, *, apply: bool) -> Engine:
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite":
        if not parsed.database or not Path(parsed.database).is_file():
            raise CatalogSyncError("Migrate an existing commerce database before syncing")
        if not apply:
            # No WAL pragma or accidental empty database creation in preview mode.
            uri = Path(parsed.database).resolve().as_uri()
            return create_engine(f"sqlite:///{uri}?mode=ro&uri=true")
    return make_engine(url)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True, help="Reviewed full catalog export")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expect-plan", help="plan_version from the dry-run")
    parser.add_argument(
        "--restore-present", action="store_true", help="Explicitly re-enable present identities"
    )
    args = parser.parse_args(argv)
    if args.apply != bool(args.expect_plan):
        parser.error("--apply and --expect-plan must be used together")
    engine = None
    try:
        source = load_snapshot(args.catalog)
        engine = sync_engine(settings.database_url, apply=args.apply)
        with Session(engine) as db, db.begin():
            if not args.apply and engine.dialect.name == "postgresql":
                db.execute(text("SET TRANSACTION READ ONLY"))
            plan = (
                apply_availability(
                    db, source, args.expect_plan, restore_present=args.restore_present
                )
                if args.apply
                else plan_availability(db, source, restore_present=args.restore_present)
            )
        print(json.dumps({"applied": args.apply, **asdict(plan)}, sort_keys=True))
        return 0
    except CatalogSyncError as exc:
        print(json.dumps({"code": "catalog_sync_rejected", "detail": str(exc)}), file=sys.stderr)
    except (OSError, ValueError, ValidationError, SQLAlchemyError):
        # No raw SQL, credentials, filesystem paths or rejected input in ordinary output.
        print(
            json.dumps(
                {
                    "code": "catalog_sync_failed",
                    "detail": "Check snapshot, migrations and database access",
                }
            ),
            file=sys.stderr,
        )
    finally:
        if engine is not None:
            engine.dispose()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
