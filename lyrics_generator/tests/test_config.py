"""Config regression tests.

These are intentionally lightweight: they ensure our environment config files stay
aligned with the monorepo layout.

Why: a wrong `storage.base_path` will cause the lyrics service to 404 when the
backend sends a storage key like `bob_dylan/.../vocals.mp3`.
"""

from __future__ import annotations

from lyrics_generator.config import load_settings


def test_local_storage_base_path_points_to_repo_bucket() -> None:
    settings = load_settings(app_env="local")
    assert settings.storage.backend == "local"
    assert settings.storage.base_path == "../local_bucket"


def test_test_storage_base_path_points_to_test_bucket() -> None:
    settings = load_settings(app_env="test")
    assert settings.storage.backend == "local"
    assert settings.storage.base_path == "../local_bucket_test"
