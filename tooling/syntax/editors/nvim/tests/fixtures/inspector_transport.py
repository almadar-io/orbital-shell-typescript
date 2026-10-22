import json
import os
import select
import sys
import time


def send(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    request = json.loads(line)
    method = request["method"]
    if method == "sequential":
        readable, _, _ = select.select([sys.stdin], [], [], 0.03)
        if readable:
            send({"id": request["id"], "error": {"code": "OVERLAPPING_REQUESTS"}})
        else:
            send({"id": request["id"], "result": request["params"]})
    elif method == "fragmented":
        wire = (json.dumps({"id": request["id"], "result": "休憩 café 🌿"}, ensure_ascii=False) + "\n").encode("utf-8")
        for byte in wire:
            os.write(sys.stdout.fileno(), bytes([byte]))
            time.sleep(0.002)
    elif method == "notify":
        send({"method": "execution/trace", "params": {"state": "休憩", "sequence": 1}})
        send({"method": "execution/trace", "params": {"state": "running", "sequence": 2}})
        send({"id": request["id"], "result": {"subscribed": True}})
    elif method == "malformed":
        sys.stdout.write("{broken response\n")
        sys.stdout.flush()
    elif method == "wrong_shape":
        send({"result": "missing ID"})
    elif method == "exit":
        sys.stdout.write("incomplete final response")
        sys.stdout.flush()
        sys.exit(7)
    elif method == "wait":
        time.sleep(60)
    else:
        send({"id": request["id"], "result": request["params"]})
