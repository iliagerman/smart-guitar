"""Read NDJSON lines from stdin and print progress/results in a human-friendly way."""

import json
import sys

while True:
    line = sys.stdin.readline()
    if not line:
        break
    line = line.strip()
    if not line:
        continue
    try:
        d = json.loads(line)
    except json.JSONDecodeError:
        print(line, flush=True)
        continue
    if "progress" in d:
        print(f"  {d['progress']}", flush=True)
    elif "result" in d:
        print(json.dumps(d["result"], indent=2), flush=True)
    else:
        print(json.dumps(d, indent=2), flush=True)
