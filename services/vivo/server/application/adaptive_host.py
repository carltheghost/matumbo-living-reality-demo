"""Private learned 3-11D material pump for the canonical local app."""
from __future__ import annotations
import asyncio
import copy
import re
import sys
from pathlib import Path

_REPOSITORY = Path(__file__).resolve().parents[4]
if str(_REPOSITORY) not in sys.path:
    sys.path.insert(0, str(_REPOSITORY))

from services.vivo_adaptive import AdaptiveGraphDriver
from services.vivo_adaptive.adapter import AcceptedAdaptiveAdapter

WALL_TICK_HZ = 2.0
SIMULATION_STEP_SECONDS = .01
_RACE = {"MATERIAL_STALE_AUTHORITY","MATERIAL_STALE_REVISION","MATERIAL_STALE_CONSTRAINTS"}
_PAUSE = {"MATERIAL_PAUSED", "JOURNAL_BACKPRESSURE"}


class AdaptiveHostError(RuntimeError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def initialize_adaptive(snapshot):
    driver = AdaptiveGraphDriver.initialize(snapshot)
    checkpoint = driver.checkpoint()
    result = copy.deepcopy(snapshot)
    for sid, space in checkpoint["spaces"].items():
        result["spaces"][sid]["field"]["hash"] = checkpoint["digest"]
        for eid, record in space["entities"].items():
            result["spaces"][sid]["entities"][eid]["q"] = copy.deepcopy(record["q"])
            result["spaces"][sid]["entities"][eid]["v"] = copy.deepcopy(record["v"])
            result["spaces"][sid]["entities"][eid]["revision"] = record["revision"]
    validate_adaptive_checkpoint(result, checkpoint)
    return {"snapshot": result, "checkpoint": checkpoint}


def validate_adaptive_checkpoint(snapshot, checkpoint):
    driver = AdaptiveGraphDriver(checkpoint)
    cp = driver.checkpoint()
    if snapshot.get("simulationTime") != cp["simulationTime"]:
        raise AdaptiveHostError("STALE_MATERIAL_TIME")
    for sid, state_space in cp["spaces"].items():
        space = snapshot.get("spaces", {}).get(sid)
        if not space or space.get("field", {}).get("hash") != cp["digest"]:
            raise AdaptiveHostError("STALE_MATERIAL_FIELD")
        for eid, record in state_space["entities"].items():
            entity = space.get("entities", {}).get(eid)
            if not entity or entity["q"] != record["q"] or entity["v"] != record["v"] or entity["revision"] != record["revision"]:
                raise AdaptiveHostError("ENTITY_FIELD_MISMATCH")
    return cp


class AdaptiveApplicationHost:
    def __init__(self, private_call):
        if not callable(private_call):
            raise AdaptiveHostError("MATERIAL_HOST_CONFIGURATION")
        self._call = private_call
        self._task = None
        self._running = False
        self._started = False
        self._stopped = False
        self._wake = asyncio.Event()
        self._fault = None
        self._pause_reason = None
        self._generation = 0
        self._accepted_steps = 0
        self._discarded_steps = 0
        self._last_sequence = None
        self._last_tick = None
        self._simulation_time = None
        self._world_id = None
        self._authority_id = None

    def status(self):
        state = "faulted" if self._fault else "stopped" if self._stopped else "running" if self._running else "paused" if self._started else "not-started"
        return {"state": state, "running": self._running, "wallTickHz": WALL_TICK_HZ,
                "simulationStepSeconds": SIMULATION_STEP_SECONDS, "acceptedSteps": self._accepted_steps,
                "discardedSteps": self._discarded_steps, "acceptedSequence": self._last_sequence,
                "tick": self._last_tick, "simulationTime": self._simulation_time,
                "pauseReason": self._pause_reason, "fault": copy.deepcopy(self._fault)}

    def _fail(self, error, stage):
        code = getattr(error, "code", None)
        if not isinstance(code, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", code):
            code = "ADAPTIVE_" + stage.upper() + "_FAILED"
        self._fault = {"code": code, "stage": stage,
                       "message": "Adaptive material stopped. Restart after inspecting the local service."}
        self._running = False
        self._generation += 1
        self._wake.set()

    async def start(self):
        if self._stopped or self._fault:
            raise AdaptiveHostError("MATERIAL_HOST_RESTART_REQUIRED")
        if self._started:
            return self.status()
        capture = await self._call("materialCapture", args={"spaceId": "root"})
        cp = await asyncio.to_thread(validate_adaptive_checkpoint, capture["snapshot"], capture["checkpoint"])
        self._world_id, self._authority_id = capture["snapshot"]["worldId"], capture["snapshot"]["authorityId"]
        self._last_sequence = capture["snapshot"]["acceptedSequence"]
        self._last_tick = cp["tick"]
        self._simulation_time = cp["simulationTime"]
        self._started = True
        self._task = asyncio.create_task(self._loop(), name="vivo-adaptive-material")
        return self.status()

    async def set_running(self, running):
        if type(running) is not bool:
            raise AdaptiveHostError("MATERIAL_RUN_FLAG")
        if running and (not self._started or self._stopped or self._fault):
            raise AdaptiveHostError("MATERIAL_HOST_RESTART_REQUIRED")
        if running != self._running:
            self._running = running
            self._pause_reason = None
            self._generation += 1
            self._wake.set()
        return self.status()

    async def pause(self, reason="MATERIAL_PAUSED"):
        """Record an authority-owned pause without treating it as a manual stop.

        The Node authority can pause material when the last local session is
        closed. Keep that lifecycle evidence visible to the Python host so a
        later rejoin is observably paused for the same reason and can resume
        cleanly. Explicit materialRun(False) still uses set_running(False) and
        intentionally clears this reason.
        """
        if not isinstance(reason, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", reason):
            raise AdaptiveHostError("MATERIAL_PAUSE_REASON")
        if self._running or self._pause_reason != reason:
            self._running = False
            self._pause_reason = reason
            self._generation += 1
            self._wake.set()
        return self.status()

    async def stop(self):
        self._running = False
        self._stopped = True
        self._generation += 1
        self._wake.set()
        if self._task:
            await self._task
        return self.status()

    async def _loop(self):
        interval = 1.0 / WALL_TICK_HZ
        loop = asyncio.get_running_loop()
        next_at = loop.time()
        while not self._stopped:
            if not self._running:
                self._wake.clear()
                await self._wake.wait()
                next_at = loop.time()
                continue
            delay = next_at - loop.time()
            if delay > 0:
                try:
                    self._wake.clear()
                    await asyncio.wait_for(self._wake.wait(), delay)
                    continue
                except asyncio.TimeoutError:
                    pass
            next_at = max(next_at + interval, loop.time())
            if not self._running or self._stopped:
                continue
            generation = self._generation
            try:
                capture = await self._call("materialCapture", args={"spaceId": "root"})
                if not self._running or self._stopped or generation != self._generation:
                    self._discarded_steps += 1
                    continue
                snapshot = capture["snapshot"]
                validate_adaptive_checkpoint(snapshot, capture["checkpoint"])
                if snapshot["worldId"] != self._world_id or snapshot["authorityId"] != self._authority_id:
                    raise AdaptiveHostError("AUTHORITY_MISMATCH")
                adapter = AcceptedAdaptiveAdapter(lambda: capture, world_id=self._world_id, authority_id=self._authority_id)
                proposal = await asyncio.to_thread(
                    adapter.propose, capture["checkpoint"],
                    expected_sequence=snapshot["acceptedSequence"],
                    expected_state_hash=snapshot["stateHash"],
                    dt=SIMULATION_STEP_SECONDS,
                    tick=capture["checkpoint"]["tick"] + 1,
                )
                if not self._running or self._stopped or generation != self._generation:
                    self._discarded_steps += 1
                    continue
                accepted = await self._call("materialApply", args={"proposal": proposal})
                self._accepted_steps += 1
                self._last_sequence = accepted["acceptedSequence"]
                self._last_tick = proposal["fieldState"]["tick"]
                self._simulation_time = proposal["fieldState"]["simulationTime"]
            except Exception as error:
                code = getattr(error, "code", None)
                if code in _PAUSE:
                    self._discarded_steps += 1
                    if self._running and not self._stopped and generation == self._generation:
                        self._running = False
                        self._pause_reason = code
                        self._generation += 1
                        self._wake.set()
                    continue
                elif code in _RACE:
                    self._discarded_steps += 1
                    continue
                self._fail(error, "step")
