#!/usr/bin/env python3
"""Build the site, rebuild changed Markdown automatically, and serve a preview."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "scripts" / "build.py"
WATCHED_DIRS = [ROOT / "content", ROOT / "posts"]
DEFAULT_PORT = 8010


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


def find_available_port(start: int = DEFAULT_PORT, attempts: int = 20) -> int:
    for port in range(start, start + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise OSError(f"No available preview port found from {start} to {start + attempts - 1}.")


def main() -> None:
    build()
    os.chdir(ROOT)
    threading.Thread(target=watch, daemon=True).start()
    port = find_available_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), SimpleHTTPRequestHandler)
    url = f"http://127.0.0.1:{port}/index.html"
    print(f"Preview: {url}")
    print("Watching content/posts and posts/*.md for Markdown and image changes. Press Ctrl+C to stop.")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPreview stopped.")


if __name__ == "__main__":
    main()
