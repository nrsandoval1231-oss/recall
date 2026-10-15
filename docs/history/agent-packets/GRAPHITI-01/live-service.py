"""Synthetic verification launcher: ephemeral secrets enter on stdin, never disk."""
import json
import os
import sys
from pathlib import Path

os.environ.update(json.loads(sys.stdin.readline()))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services/backend/src"))
from recall.knowledge.cli import main

main()
