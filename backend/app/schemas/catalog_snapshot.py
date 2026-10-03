"""Validate identities before an operator can retire anything from a full export."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from app.domain.catalog_identity import CatalogIdentity


class SnapshotColor(BaseModel):
    model_config = ConfigDict(strict=True)
    name: Annotated[str, Field(pattern=r"^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,98}[A-Za-z0-9])?$")]


class SnapshotProduct(BaseModel):
    model_config = ConfigDict(strict=True)
    id: Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")]
    handle: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9-]{0,99}$")]
    colors: Annotated[list[SnapshotColor], Field(max_length=100)]
    sizes: Annotated[list[Annotated[int, Field(ge=1, le=99)]], Field(max_length=99)]

    @model_validator(mode="after")
    def unique_options(self) -> "SnapshotProduct":
        names = [c.name.casefold() for c in self.colors]
        if len(set(names)) != len(names) or len(set(self.sizes)) != len(self.sizes):
            raise ValueError("Duplicate variant options")
        return self

    def identity(self) -> CatalogIdentity:
        return CatalogIdentity(
            self.id, self.handle, tuple(c.name for c in self.colors), tuple(self.sizes)
        )


Snapshot = Annotated[list[SnapshotProduct], Field(min_length=1, max_length=10000)]
snapshot_adapter = TypeAdapter(Snapshot)
