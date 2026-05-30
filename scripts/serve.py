#!/usr/bin/env python3
"""Build the site, rebuild changed Markdown automatically, and serve a preview."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "scripts" / "build.py"
WATCHED_DIRS = [ROOT / "content", ROOT / "posts"]


def build() -> None:
    subprocess.run([sys.executable, str(BUILD_SCRIPT)], cwd=ROOT, check=True)


def is_watched(path: Path) -> bool:
    if path.suffix.lower() == ".md":
        return True
    try:
        path.relative_to(ROOT / "posts" / "Image")
        return True
    except ValueError:
        pass
    try:
        path.relative_to(ROOT / "content" / "posts" / "images")
        return True
    except ValueError:
        return False


def snapshot() -> dict[Path, int]:
    watched_files: dict[Path, int] = {}
    for watched_dir in WATCHED_DIRS:
        if not watched_dir.exists():
            continue
        for path in watched_dir.rglob("*"):
            if path.is_file() and is_watched(path):
                watched_files[path] = path.stat().st_mtime_ns
    return watched_files


def watch() -> None:
    previous = snapshot()
    while True:
        time.sleep(1)
        current = snapshot()
        if current != previous:
            print("\nContent changed. Rebuilding...")
            try:
                build()
            except subprocess.CalledProcessError:
                print("Build failed. Fix the Markdown file and save again.")
            previous = current


def main() -> None:
    build()
    os.chdir(ROOT)
    threading.Thread(target=watch, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), SimpleHTTPRequestHandler)
    print("Preview: http://127.0.0.1:8000")
    print("Watching content/posts and posts/*.md for Markdown and image changes. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPreview stopped.")


if __name__ == "__main__":
    main()
