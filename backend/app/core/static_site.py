"""Serve the built web app (single-page app) from the API process.

Used when one container hosts everything (e.g. Render). Every path that isn't under /api/
returns the matching file from STATIC_DIR, or index.html so client-side routes work.
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

# Hashed build assets never change; the shell, service worker and manifest must be re-checked.
IMMUTABLE_PREFIX = "assets/"
NO_CACHE_FILES = {"index.html", "sw.js", "manifest.webmanifest"}


def mount_static_site(app: FastAPI, root: Path) -> None:
    root = root.resolve()
    index = root / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    def static_site(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found.")
        candidate = (root / full_path).resolve()
        # Only files inside the build folder; anything else falls back to the app shell.
        if full_path and root in candidate.parents and candidate.is_file():
            path = candidate
        else:
            path = index
        name = path.relative_to(root).as_posix()
        if name.startswith(IMMUTABLE_PREFIX):
            cache = "public, max-age=31536000, immutable"
        elif name in NO_CACHE_FILES:
            cache = "no-cache"
        else:
            cache = "public, max-age=3600"
        media_type = "application/manifest+json" if name.endswith(".webmanifest") else None
        return FileResponse(path, media_type=media_type, headers={"Cache-Control": cache})
