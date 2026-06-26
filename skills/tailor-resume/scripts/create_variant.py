#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    if not slug:
        raise ValueError("variant name cannot be empty")
    if slug in {".", ".."} or "/" in slug:
        raise ValueError(f"unsafe variant name: {value}")
    return slug


def dotenv_workspace() -> str | None:
    env_path = repo_root() / ".env"
    if not env_path.exists():
        return None
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        if key.strip() == "RESUME_WORKSPACE":
            return value.strip().strip('"').strip("'")
    return None


def resolve_workspace(value: str | None) -> Path:
    raw = value or os.environ.get("RESUME_WORKSPACE") or dotenv_workspace()
    if not raw:
        raise FileNotFoundError(
            "resume workspace not provided; pass --workspace or set RESUME_WORKSPACE"
        )
    workspace = Path(raw).expanduser().resolve()
    variants = workspace / "variants"
    if not variants.is_dir():
        raise FileNotFoundError(f"workspace has no variants directory: {workspace}")
    if not list(variants.glob("*/resume.yaml")):
        raise FileNotFoundError(f"workspace has no variants/*/resume.yaml files: {workspace}")
    return workspace


def create_variant(workspace: Path, source: str, target: str) -> dict[str, str]:
    source_slug = slugify(source)
    target_slug = slugify(target)
    source_resume = workspace / "variants" / source_slug / "resume.yaml"
    target_dir = workspace / "variants" / target_slug
    target_resume = target_dir / "resume.yaml"

    if not source_resume.is_file():
        raise FileNotFoundError(f"source variant does not exist: {source_slug}")
    if target_dir.exists():
        raise FileExistsError(f"target variant already exists: {target_slug}")

    target_dir.mkdir(parents=True)
    shutil.copy2(source_resume, target_resume)
    return {
        "workspace": str(workspace),
        "source": source_slug,
        "target": target_slug,
        "resume": str(target_resume),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a Resume Studio variant by copying only resume.yaml."
    )
    parser.add_argument("--workspace", help="Path to the resume workspace.")
    parser.add_argument("--source", required=True, help="Source variant slug or name.")
    parser.add_argument("--target", required=True, help="Target variant name.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = create_variant(
            resolve_workspace(args.workspace),
            source=args.source,
            target=args.target,
        )
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
