from __future__ import annotations

import os
import sys


def main() -> None:
    if sys.platform == "win32":
        raise SystemExit("Run Recall knowledge service inside WSL; native Windows FalkorDB is unsupported.")
    host = os.environ.get("RECALL_GRAPH_HOST", "127.0.0.1")
    if host != "127.0.0.1":
        raise SystemExit("RECALL_GRAPH_HOST must be 127.0.0.1.")
    try:
        import uvicorn

        from .app import create_app

        port = int(os.environ.get("RECALL_GRAPH_PORT", "8766"))
        if not 1 <= port <= 65535:
            raise ValueError
        app = create_app()
    except ValueError:
        raise SystemExit("RECALL_GRAPH_PORT must be a valid TCP port.") from None
    uvicorn.run(app, host=host, port=port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
