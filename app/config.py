from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


DEFAULT_WORKSPACE = Path.home() / "projects" / "resume-workspace"
_workspace_override: Path | None = None


@dataclass(frozen=True)
class Settings:
    workspace: Path


def get_settings() -> Settings:
    workspace = _workspace_override or Path(
        os.environ.get("RESUME_WORKSPACE", DEFAULT_WORKSPACE)
    ).expanduser()
    return Settings(workspace=workspace)


def set_workspace_override(workspace: Path) -> None:
    global _workspace_override
    _workspace_override = workspace.expanduser()


def clear_workspace_override() -> None:
    global _workspace_override
    _workspace_override = None
