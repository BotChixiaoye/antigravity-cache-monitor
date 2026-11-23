#!/usr/bin/env python3
"""Silent PostInvocation hook that records the active conversation metadata
for the Cache Hit Monitor MCP App side pane.

Always prints {} so nothing is ever injected into the conversation or model context.
"""

import json
import os
import sys
import time
from pathlib import Path


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        print("{}")
        return

    transcript_path = payload.get("transcriptPath")
    conv_id = payload.get("conversationId")
    if transcript_path and conv_id:
        data_dir = Path(os.environ.get("PLUGIN_DATA") or "/tmp/cache-hit-monitor")
        try:
            data_dir.mkdir(parents=True, exist_ok=True)
            active_file = data_dir / "active.json"
            tmp_file = data_dir / "active.json.tmp"
            record = {
                "conversationId": str(conv_id),
                "transcriptPath": str(transcript_path),
                "modelName": str(payload.get("modelName") or ""),
                "updatedAt": time.time(),
            }
            tmp_file.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
            tmp_file.replace(active_file)
        except Exception:
            pass

    print("{}")


if __name__ == "__main__":
    main()
