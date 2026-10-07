import pytest


@pytest.fixture(autouse=True)
def private_data_dir(tmp_path, monkeypatch):
    """Every test gets its own puzzle database; the real one (backend/data) is never touched."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
