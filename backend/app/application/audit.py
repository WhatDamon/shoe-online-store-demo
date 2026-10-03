from typing import Any

from sqlalchemy.orm import Session

from app.domain.models import AuditLog


def audit(db: Session, entity: str, action: str, **details: Any) -> None:
    db.add(AuditLog(entity_id=entity, action=action, details=details))
