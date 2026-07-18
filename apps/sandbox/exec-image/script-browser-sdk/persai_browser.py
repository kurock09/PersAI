"""Narrow synchronous PersAI Script browser SDK (snapshot/act only)."""

import json
import subprocess
from typing import Any, Dict


def _call(action: str, request: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(request)
    payload["action"] = action
    completed = subprocess.run(
        ["/usr/local/bin/persai-browser", json.dumps(payload, separators=(",", ":"))],
        check=True,
        capture_output=True,
        pass_fds=(3, 4),
        text=True,
    )
    return json.loads(completed.stdout)


def snapshot(request: Dict[str, Any]) -> Dict[str, Any]:
    return _call("snapshot", request)


def act(request: Dict[str, Any]) -> Dict[str, Any]:
    return _call("act", request)
