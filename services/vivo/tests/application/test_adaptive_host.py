from __future__ import annotations

import asyncio
import copy
import time
import unittest

from services.vivo_adaptive.tests.test_adaptive import snapshot
from services.vivo.server.application.adaptive_host import (
    AdaptiveApplicationHost,
    initialize_adaptive,
)


class PrivatePause(RuntimeError):
    code = "MATERIAL_PAUSED"


class FakeAdaptiveAuthority:
    def __init__(self):
        initialized = initialize_adaptive(snapshot())
        self.capture = {
            "snapshot": initialized["snapshot"],
            "constraints": [],
            "authorityTimeMs": 1,
            "checkpoint": initialized["checkpoint"],
        }
        self.paused = False
        self.applied = 0

    async def __call__(self, operation, *, args):
        if operation == "materialCapture":
            if self.paused:
                raise PrivatePause("MATERIAL_PAUSED")
            return copy.deepcopy(self.capture)
        if operation == "materialApply":
            self.applied += 1
            proposal = args["proposal"]
            return {
                "worldId": proposal["worldId"],
                "authorityId": proposal["authorityId"],
                "acceptedSequence": self.applied,
                "simulationTime": proposal["fieldState"]["simulationTime"],
            }
        raise AssertionError(operation)


async def wait_until(predicate, timeout=4):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(.02)
    raise AssertionError("condition timed out")


class AdaptiveHostLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_authority_pause_is_nonfatal_and_resume_accepts_again(self):
        authority = FakeAdaptiveAuthority()
        host = AdaptiveApplicationHost(authority)
        await host.start()
        try:
            await host.set_running(True)
            authority.paused = True
            await wait_until(lambda: host.status()["pauseReason"] == "MATERIAL_PAUSED")
            paused = host.status()
            self.assertFalse(paused["running"])
            self.assertEqual(paused["state"], "paused")
            self.assertIsNone(paused["fault"])

            authority.paused = False
            await host.set_running(True)
            await wait_until(lambda: host.status()["acceptedSteps"] > 0)
            resumed = host.status()
            self.assertEqual(resumed["state"], "running")
            self.assertIsNone(resumed["fault"])
        finally:
            await host.stop()


if __name__ == "__main__":
    unittest.main()
