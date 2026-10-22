import json
import sys


def selection(trait):
    return {
        "orbital": "fixture", "trait": trait,
        "machine": {"id": trait},
        "graph": {"nodes": [{"id": trait, "label": trait}], "edges": []},
        "nodeSources": [], "edgeSources": [], "composition": {},
    }


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


path, version, observed = "", 0, None
for line in sys.stdin:
    request = json.loads(line)
    method, params = request["method"], request["params"]
    if method == "inspect":
        path, version = params["path"], params["version"]
        result = {"path": path, "version": version, "machines": [{"orbital": "fixture", "trait": "first"}]}
    elif method == "select":
        result = selection(params["trait"])
    elif method == "layout":
        node = dict(params["nodes"][0], x=1, y=1, rank=0)
        result = {"layout": {"nodes": [node], "edges": [], "width": node["width"] + 2, "height": node["height"] + 2}}
    elif method == "attach":
        instance = params["instance"]
        update = {"path": path, "documentVersion": version, "traitId": "first", "instance": instance,
                  "programVersion": 7, "sequence": 3, "activeNodeIds": ["first"], "firedEdgeIds": [],
                  "frames": [{"traitId": "first", "stateEntityId": "row-1", "binding": "source", "activeNodeId": "first", "completedEdgeIds": [], "sequence": 3}]}
        if params["origin"] == "fixture://ambiguity":
            update.update(activeNodeIds=[], frames=[], bindingIssues=[{"code": "AMBIGUOUS_SOURCE_DECLARATION", "traitId": "runtime-generic", "stateEntityId": "row-1", "candidates": ["one", "two"]}])
        for key, wrong in [("path", "wrong.lolo"), ("documentVersion", version - 1), ("traitId", "wrong-trait"), ("instance", "wrong-instance")]:
            invalid = dict(update)
            invalid[key] = wrong
            send({"method": "trace", "params": {"type": "trace", "instance": instance, "diagramUpdates": [invalid]}})
        if params["origin"] != "fixture://mismatches":
            observed = update
            send({"method": "trace", "params": {"type": "trace", "instance": instance, "diagramUpdates": [update], "fullDetail": "字" * 400}})
            stale = dict(update, sequence=2, activeNodeIds=["stale-must-not-highlight"])
            send({"method": "trace", "params": {"type": "trace", "instance": instance, "diagramUpdates": [stale]}})
        if params["origin"] == "fixture://disconnect":
            send({"method": "trace", "params": {"type": "trace-disconnected", "instance": instance, "reason": "fixture complete"}})
        result = {"attached": True}
    elif method == "detach":
        observed = None
        result = {"detached": True}
    elif method == "focus":
        if params["path"] != path or params["version"] != version:
            raise ValueError("cursor request used wrong document identity")
        focus = {"traitId": "first", "nodeIds": [], "edgeIds": []}
        result = {"path": path, "version": version, "orbital": "fixture", "trait": "first", "focus": focus}
        if params["line"] == 1:
            if params["column"] != 3:
                raise ValueError("expected Unicode scalar column 3, got " + str(params["column"]))
            focus["nodeIds"] = ["first"]
        elif params["line"] == 2:
            result.update(selection("second"))
            focus.update(traitId="second", nodeIds=["second"])
            if observed is not None:
                projected = dict(observed, traitId="second", activeNodeIds=["second"])
                send({"method": "diagram", "params": {"instance": observed["instance"], "programVersion": 7, "diagramUpdates": [projected]}})
        elif params["line"] == 3:
            result["focus"] = {"ambiguous": True, "candidates": []}
        elif params["line"] == 5:
            result["version"] = version - 1
            focus["nodeIds"] = ["stale-response-must-not-highlight"]
    else:
        raise ValueError("unexpected method " + method)
    send({"id": request["id"], "result": result})
