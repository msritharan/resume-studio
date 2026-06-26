from pathlib import Path

from app.config import clear_workspace_override, get_settings, set_workspace_override


def test_reads_workspace_from_env(monkeypatch):
    clear_workspace_override()
    monkeypatch.setenv("RESUME_WORKSPACE", "/tmp/resume-workspace-test")

    assert get_settings().workspace == Path("/tmp/resume-workspace-test")


def test_workspace_override_wins_over_env(monkeypatch):
    clear_workspace_override()
    monkeypatch.setenv("RESUME_WORKSPACE", "/tmp/resume-workspace-test")

    set_workspace_override(Path("/tmp/chosen-resume-workspace"))

    assert get_settings().workspace == Path("/tmp/chosen-resume-workspace")
    clear_workspace_override()
