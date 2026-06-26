from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


DEFAULT_WORKSPACE = Path.home() / "projects" / "resume-workspace"


@dataclass(frozen=True)
class Settings:
    workspace: Path


def get_settings() -> Settings:
    workspace = Path(os.environ.get("RESUME_WORKSPACE", DEFAULT_WORKSPACE)).expanduser()
    return Settings(workspace=workspace)

