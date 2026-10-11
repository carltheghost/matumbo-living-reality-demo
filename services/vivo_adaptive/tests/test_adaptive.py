from __future__ import annotations

import copy
import hashlib
import math
import unittest

from services.vivo_adaptive.driver import (
    AdaptiveGraphDriver, AdaptiveMaterialError, MODEL_PATH, MODEL_SHA256
)


def entity(eid, sid, d, q):
    return {
        "id": eid, "spaceId": sid, "dimension": d, "chart": "flat",
        "q": list(q), "v": [0.0] * d, "revision": 0, "name": eid,
        "radius": 0.2, "materialProfile": "adaptive-graph",
        "fieldMembership": ["field." + eid], "lineage": [], "innerSpaceId": None,
    }


def snapshot(d=4):
    a = entity("a", "root", d, [0.0] * d)
    bq = [0.0] * d
    bq[0] = 1.0
    b = entity("b", "root", d, bq)
    return {
        "schema": "vivo.snapshot/1", "worldId": "world", "authorityId": "authority",
        "acceptedSequence": 0, "simulationTime": 0.0, "rootSpaceId": "root",
        "stateHash": "0" * 64,
        "spaces": {"root": {
            "id": "root", "dimension": d, "intrinsicDimension": d,
            "atlasId": "flat", "metricId": "euclidean", "topologyId": "open",
            "law": {"id": "vivo.adaptive.graph", "version": "1"},
            "modelHashes": [MODEL_SHA256],
            "field": {"codec": "vivo.material.adaptive-graph/1", "handle": "adaptive.root", "hash": "0" * 64},
            "adaptiveEdges": [["a", "b"]],
            "entryView": {"spaceId": "root", "chart": "flat", "dimension": d, "q": [0] * d, "basis": [], "slice": {}},
            "entities": {"a": a, "b": b},
        }},
    }


def payload(driver, snap, grips=None, dt=0.01):
    return {
        "snapshot": snap, "fieldState": driver.checkpoint(), "grips": grips or [],
        "dt": dt, "tick": driver.checkpoint()["tick"] + 1,
        "randomState": "deterministic:none", "mode": "learned",
    }


class AdaptiveGraphTests(unittest.TestCase):
    def test_model_hash_and_capabilities(self):
        self.assertEqual(hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest(), MODEL_SHA256)
        caps = AdaptiveGraphDriver.capabilities()
        self.assertEqual(caps["spatialDimensions"], list(range(3, 12)))
        self.assertTrue(caps["learned"])
        self.assertTrue(caps["multiGrip"])

    def test_all_dimensions_3_to_11_and_time_separate(self):
        for d in range(3, 12):
            s = snapshot(d)
            driver = AdaptiveGraphDriver.initialize(s)
            before = driver.checkpoint()
            result = driver.step(payload(driver, s))
            self.assertEqual(len(result["entityUpdates"][0]["q"]), d)
            self.assertAlmostEqual(result["fieldState"]["simulationTime"], 0.01)
            self.assertEqual(result["fieldState"]["tick"], 1)
            self.assertEqual(before["spaces"]["root"]["dimension"], d)

    def test_equilibrium_edge_does_not_self_launch(self):
        s = snapshot(7)
        driver = AdaptiveGraphDriver.initialize(s)
        result = driver.step(payload(driver, s))
        for update in result["entityUpdates"]:
            self.assertLess(math.dist(update["q"], s["spaces"]["root"]["entities"][update["id"]]["q"]), 1e-12)

    def test_last_axis_grip_moves_real_last_coordinate(self):
        d = 11
        s = snapshot(d)
        driver = AdaptiveGraphDriver.initialize(s)
        target = [0.0] * d
        target[-1] = 1.0
        grip = {
            "spaceId": "root", "entityId": "a", "source": "touch",
            "target": {"spaceId": "root", "dimension": d, "chart": "flat", "q": target},
            "stiffness": 2.0, "maxForce": 2.0,
        }
        result = driver.step(payload(driver, s, [grip]))
        moved = next(u for u in result["entityUpdates"] if u["id"] == "a")
        self.assertGreater(moved["q"][-1], 0)
        self.assertEqual(moved["q"][1:-1], [0.0] * (d - 2))

    def test_two_grips_on_one_entity_combine_without_duplicate_state(self):
        s = snapshot(4)
        driver = AdaptiveGraphDriver.initialize(s)
        grips = []
        for axis in (1, 3):
            q = [0.0] * 4
            q[axis] = 1.0
            grips.append({
                "spaceId": "root", "entityId": "a", "source": "touch" if axis == 1 else "hand",
                "target": {"spaceId": "root", "dimension": 4, "chart": "flat", "q": q},
                "stiffness": 2.0, "maxForce": 2.0,
            })
        result = driver.step(payload(driver, s, grips))
        moved = next(u for u in result["entityUpdates"] if u["id"] == "a")
        self.assertGreater(moved["q"][1], 0)
        self.assertGreater(moved["q"][3], 0)
        self.assertEqual(len([u for u in result["entityUpdates"] if u["id"] == "a"]), 1)

    def test_learned_edge_stiffness_changes_with_strain(self):
        s = snapshot(3)
        driver = AdaptiveGraphDriver.initialize(s)
        cp = driver.checkpoint()
        cp["spaces"]["root"]["entities"]["b"]["q"][0] = 1.4
        cp["digest"] = __import__("services.vivo_adaptive.driver", fromlist=["_checkpoint_digest"])._checkpoint_digest(cp)
        driver.restore(cp)
        s["spaces"]["root"]["entities"]["b"]["q"][0] = 1.4
        result = driver.step(payload(driver, s))
        edge = result["edgeDiagnostics"][0]
        self.assertGreater(edge["strain"], 0.39)
        self.assertGreaterEqual(edge["stiffness"], 0.5)
        self.assertLessEqual(edge["stiffness"], 2.0)
        self.assertGreater(edge["force"], 0)

    def test_translation_equivariance(self):
        s1 = snapshot(5)
        s2 = copy.deepcopy(s1)
        shift = [2.0, -1.0, 0.5, 3.0, -2.0]
        for e in s2["spaces"]["root"]["entities"].values():
            e["q"] = [a + b for a, b in zip(e["q"], shift)]
        d1 = AdaptiveGraphDriver.initialize(s1)
        d2 = AdaptiveGraphDriver.initialize(s2)
        r1 = d1.step(payload(d1, s1))
        r2 = d2.step(payload(d2, s2))
        by1 = {u["id"]: u for u in r1["entityUpdates"]}
        by2 = {u["id"]: u for u in r2["entityUpdates"]}
        for eid in by1:
            delta = [b - a for a, b in zip(by1[eid]["q"], by2[eid]["q"])]
            for got, expected in zip(delta, shift):
                self.assertAlmostEqual(got, expected, places=12)

    def test_checkpoint_tamper_fails(self):
        driver = AdaptiveGraphDriver.initialize(snapshot())
        cp = driver.checkpoint()
        cp["spaces"]["root"]["entities"]["a"]["q"][0] = 99
        with self.assertRaisesRegex(AdaptiveMaterialError, "CHECKPOINT_HASH"):
            AdaptiveGraphDriver(cp)

    def test_snapshot_is_not_mutated(self):
        s = snapshot(4)
        before = copy.deepcopy(s)
        driver = AdaptiveGraphDriver.initialize(s)
        driver.step(payload(driver, s))
        self.assertEqual(s, before)

    def test_stale_revision_rejected(self):
        s = snapshot(4)
        driver = AdaptiveGraphDriver.initialize(s)
        s["spaces"]["root"]["entities"]["a"]["revision"] = 1
        with self.assertRaisesRegex(AdaptiveMaterialError, "STALE_REVISION"):
            driver.step(payload(driver, s))


if __name__ == "__main__":
    unittest.main()
