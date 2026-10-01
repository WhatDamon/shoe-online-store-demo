from pathlib import Path


def test_application_layer_does_not_import_fastapi():
    root = Path(__file__).parents[1] / "app" / "application"
    assert all("fastapi" not in path.read_text(encoding="utf-8") for path in root.glob("*.py"))
