from dataclasses import dataclass
from uuid import NAMESPACE_URL, uuid5


def stable_variant_id(handle: str, color: str, size: int) -> str:
    return str(uuid5(NAMESPACE_URL, f"evoloop/{handle}/{color.casefold()}/{size}"))


@dataclass(frozen=True)
class CatalogIdentity:
    id: str
    handle: str
    colors: tuple[str, ...]
    sizes: tuple[int, ...]

    def variant_ids(self) -> set[str]:
        return {
            stable_variant_id(self.handle, color, size)
            for color in self.colors or ("Standard",)
            for size in self.sizes
        }
