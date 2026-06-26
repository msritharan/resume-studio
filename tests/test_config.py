from pathlib import Path

from app.config import get_settings


def test_reads_workspace_from_env(monkeypatch):
    monkeypatch.setenv("RESUME_WORKSPACE", "/tmp/resume-workspace-test")

    assert get_settings().workspace == Path("/tmp/resume-workspace-test")

