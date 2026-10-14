"""Trainable v0.2 cores for the interactive Vevo proof.

The five-brain model keeps four recurrent peripheral states and a structurally
different recurrent center.  The center's differentiable addressable memory
is in the recurrent state, while the exact note workspace and tool executor
remain outside the weights.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import math

import numpy as np

from .autograd import Tensor, concatenate, log, sigmoid, softmax, tanh


ACTION_NAMES = tuple(f"choice_{index}" for index in range(4))


@dataclass
class V02TrainResult:
    model: object
    best_step: int
    best_validation_loss: float
    history: list[dict]
    optimizer_steps: int


def _validate_trace(trace: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    observations = np.asarray(trace["observations"], dtype=np.float64)
    stages = np.asarray(trace["stages"], dtype=int)
    tools = np.asarray(trace["tools"], dtype=np.float64)
    targets = np.asarray(trace["targets"], dtype=int)
    if observations.ndim != 3 or observations.shape[1:] != (4, 6):
        raise ValueError("observations must be T by four by six")
    if stages.shape != (len(observations),) or tools.shape != (len(observations), 8):
        raise ValueError("invalid stage/tool trace")
    if targets.shape != (len(observations),) or np.any((targets < 0) | (targets >= 4)):
        raise ValueError("invalid action targets")
    return observations, stages, tools, targets


class V02Brain:
    """Exactly four recurrent peripherals plus a recurrent memory center."""

    PERIPHERALS = 4
    OBS_DIM = 6
    PERIPH_HIDDEN = 7
    CENTRAL_HIDDEN = 5
    MEMORY_SLOTS = 2
    MEMORY_DIM = 4
    TOOL_DIM = 8
    STAGE_DIM = 3
    ACTION_DIM = 4
    STAGE_WEIGHTS = (3.0, 1.0, 1.0)

    def __init__(self, seed: int = 7):
        if type(seed) is not int or seed < 0:
            raise ValueError("model seed must be a non-negative integer")
        self.seed = seed
        rng = np.random.default_rng(seed)
        self.params: dict[str, np.ndarray] = {}

        def normal(name: str, shape: tuple[int, ...], scale: float) -> None:
            self.params[name] = rng.normal(0.0, scale, shape).astype(np.float64)

        for brain in range(self.PERIPHERALS):
            normal(f"p{brain}.W_in", (self.PERIPH_HIDDEN, self.OBS_DIM), 0.28)
            normal(f"p{brain}.W_rec", (self.PERIPH_HIDDEN, self.PERIPH_HIDDEN), 0.18)
            self.params[f"p{brain}.b"] = np.zeros(self.PERIPH_HIDDEN, dtype=np.float64)
            normal(f"p{brain}.W_msg", (1, self.PERIPH_HIDDEN), 0.35)
            self.params[f"p{brain}.b_msg"] = np.zeros(1, dtype=np.float64)

        center_input = self.PERIPHERALS + self.STAGE_DIM + self.TOOL_DIM
        normal("c.W_in", (self.CENTRAL_HIDDEN, center_input), 0.28)
        normal("c.W_rec", (self.CENTRAL_HIDDEN, self.CENTRAL_HIDDEN), 0.12)
        self.params["c.b"] = np.zeros(self.CENTRAL_HIDDEN, dtype=np.float64)
        normal("c.W_key", (self.MEMORY_DIM, self.CENTRAL_HIDDEN), 0.28)
        normal("c.W_addr", (self.MEMORY_SLOTS, self.CENTRAL_HIDDEN), 0.25)
        normal("c.w_gate", (1, self.CENTRAL_HIDDEN), 0.22)
        self.params["c.b_gate"] = np.array([-0.25], dtype=np.float64)
        normal("c.W_value", (self.MEMORY_DIM, self.CENTRAL_HIDDEN), 0.32)
        self.params["c.b_value"] = np.zeros(self.MEMORY_DIM, dtype=np.float64)
        normal("c.W_action_key", (self.ACTION_DIM, self.MEMORY_DIM), 0.38)
        normal("c.W_action_memory", (self.ACTION_DIM, self.MEMORY_DIM), 0.38)
        self.params["c.b_action"] = np.zeros(self.ACTION_DIM, dtype=np.float64)

    @property
    def brain_count(self) -> int:
        return self.PERIPHERALS + 1

    def parameter_count(self) -> int:
        return int(sum(value.size for value in self.params.values()))

    def parameter_names(self) -> list[str]:
        return list(self.params)

    def state_dict(self) -> dict:
        return {name: value.tolist() for name, value in self.params.items()}

    def load_state_dict(self, state: dict) -> None:
        if set(state) != set(self.params):
            raise ValueError("model parameter names do not match")
        for name, current in self.params.items():
            candidate = np.asarray(state[name], dtype=np.float64)
            if candidate.shape != current.shape or not np.isfinite(candidate).all():
                raise ValueError(f"invalid parameter {name}")
            current[...] = candidate

    def clone(self) -> "V02Brain":
        result = V02Brain(self.seed)
        result.load_state_dict(self.state_dict())
        return result

    def initial_runtime(self, *, memory=None) -> dict:
        return {
            "peripheral": [np.zeros(self.PERIPH_HIDDEN, dtype=np.float64) for _ in range(self.PERIPHERALS)],
            "central": np.zeros(self.CENTRAL_HIDDEN, dtype=np.float64),
            "memory": np.zeros((self.MEMORY_SLOTS, self.MEMORY_DIM), dtype=np.float64)
            if memory is None else np.asarray(memory, dtype=np.float64).copy(),
            "last_tool": np.zeros(self.TOOL_DIM, dtype=np.float64),
        }

    @staticmethod
    def copy_runtime(runtime: dict) -> dict:
        return {
            "peripheral": [np.asarray(value, dtype=np.float64).copy() for value in runtime["peripheral"]],
            "central": np.asarray(runtime["central"], dtype=np.float64).copy(),
            "memory": np.asarray(runtime["memory"], dtype=np.float64).copy(),
            "last_tool": np.asarray(runtime.get("last_tool", np.zeros(8)), dtype=np.float64).copy(),
        }

    @staticmethod
    def _softmax(value: np.ndarray) -> np.ndarray:
        shifted = np.asarray(value, dtype=np.float64) - np.max(value)
        result = np.exp(shifted)
        return result / np.sum(result)

    def raw_step(
        self,
        runtime: dict,
        observations: np.ndarray,
        stage: int,
        tool_vector: np.ndarray | None = None,
        *,
        ablate: int | str | None = None,
        erase_memory_before_action: bool = False,
    ) -> tuple[dict, dict]:
        observations = np.asarray(observations, dtype=np.float64)
        if observations.shape != (self.PERIPHERALS, self.OBS_DIM):
            raise ValueError("observations must be four by six")
        if type(stage) is not int or not 0 <= stage < self.STAGE_DIM:
            raise ValueError("invalid stage")
        tool = np.zeros(self.TOOL_DIM, dtype=np.float64) if tool_vector is None else np.asarray(tool_vector, dtype=np.float64)
        if tool.shape != (self.TOOL_DIM,) or not np.isfinite(tool).all():
            raise ValueError("invalid typed tool vector")
        runtime = self.copy_runtime(runtime)
        messages = []
        peripheral = []
        for brain in range(self.PERIPHERALS):
            prefix = f"p{brain}."
            if ablate == brain:
                hidden = np.zeros(self.PERIPH_HIDDEN, dtype=np.float64)
                message = 0.0
            else:
                hidden = np.tanh(
                    self.params[prefix + "W_in"] @ observations[brain]
                    + self.params[prefix + "W_rec"] @ runtime["peripheral"][brain]
                    + self.params[prefix + "b"]
                )
                message = float(np.tanh(self.params[prefix + "W_msg"] @ hidden + self.params[prefix + "b_msg"])[0])
            peripheral.append(hidden)
            messages.append(message)
        messages_array = np.asarray(messages, dtype=np.float64)
        stage_one_hot = np.eye(self.STAGE_DIM, dtype=np.float64)[stage]
        center_input = np.concatenate([messages_array, stage_one_hot, tool])
        if ablate == "center":
            central = np.zeros(self.CENTRAL_HIDDEN, dtype=np.float64)
        else:
            central = np.tanh(
                self.params["c.W_in"] @ center_input
                + self.params["c.W_rec"] @ runtime["central"]
                + self.params["c.b"]
            )
        key = np.tanh(self.params["c.W_key"] @ central)
        read_weights = self._softmax((runtime["memory"] @ key) / 0.75)
        read_before = read_weights @ runtime["memory"]
        write_weights = self._softmax(self.params["c.W_addr"] @ central)
        write_gate = float(self._sigmoid(self.params["c.w_gate"] @ central + self.params["c.b_gate"])[0])
        write_value = np.tanh(self.params["c.W_value"] @ central + self.params["c.b_value"])
        memory = runtime["memory"] + write_gate * write_weights[:, None] * (write_value[None, :] - runtime["memory"])
        # The address key provides the cue/note actions.  The final gate action
        # must be read from the memory written by the diagnostic result; the
        # optional erase hook is an evaluator intervention placed immediately
        # before that final readout.
        if erase_memory_before_action:
            memory = np.zeros_like(memory)
        # Reading after the bounded write gives the first cue an actionable
        # path while preserving an explicit differentiable memory operation.
        read_after = write_weights @ memory
        action_features = (read_after + key) if stage < 2 else read_after
        action_matrix = self.params["c.W_action_key"] if stage < 2 else self.params["c.W_action_memory"]
        action_logits = action_matrix @ action_features + self.params["c.b_action"]
        action_probs = self._softmax(action_logits)
        next_runtime = {
            "peripheral": peripheral,
            "central": central,
            "memory": memory,
            "last_tool": tool.copy(),
        }
        trace = {
            "messages": messages_array,
            "central": central.copy(),
            "memory": memory.copy(),
            "read_before": read_before.copy(),
            "read_after": read_after.copy(),
            "read_weights": read_weights.copy(),
            "write_gate": write_gate,
            "write_weights": write_weights.copy(),
            "action_logits": action_logits.copy(),
            "action_probs": action_probs.copy(),
            "port_drives": np.clip(0.08 * messages_array, -0.2, 0.2),
        }
        return next_runtime, trace

    @staticmethod
    def _sigmoid(value: np.ndarray) -> np.ndarray:
        return 1.0 / (1.0 + np.exp(-np.asarray(value, dtype=np.float64)))

    def action_from_trace(self, trace: dict) -> int:
        return int(np.argmax(trace["action_probs"]))

    def brain_snapshot(self, runtime: dict) -> dict:
        return {
            "brain_count": self.brain_count,
            "peripheral": [value.tolist() for value in runtime["peripheral"]],
            "central": runtime["central"].tolist(),
            "memory": runtime["memory"].tolist(),
            "last_tool": runtime["last_tool"].tolist(),
        }

    def restore_runtime(self, state: dict) -> dict:
        if int(state.get("brain_count", -1)) != self.brain_count:
            raise ValueError("checkpoint does not contain exactly five brains")
        runtime = self.initial_runtime()
        if len(state["peripheral"]) != self.PERIPHERALS:
            raise ValueError("wrong peripheral count")
        runtime["peripheral"] = [
            np.asarray(value, dtype=np.float64).reshape(self.PERIPH_HIDDEN).copy()
            for value in state["peripheral"]
        ]
        runtime["central"] = np.asarray(state["central"], dtype=np.float64).reshape(self.CENTRAL_HIDDEN).copy()
        runtime["memory"] = np.asarray(state["memory"], dtype=np.float64).reshape(self.MEMORY_SLOTS, self.MEMORY_DIM).copy()
        runtime["last_tool"] = np.asarray(state["last_tool"], dtype=np.float64).reshape(self.TOOL_DIM).copy()
        values = runtime["peripheral"] + [runtime["central"], runtime["memory"], runtime["last_tool"]]
        if not all(np.isfinite(value).all() for value in values):
            raise ValueError("non-finite brain state")
        return runtime

    def _tensor_params(self) -> dict[str, Tensor]:
        return {name: Tensor(value.copy(), requires_grad=True) for name, value in self.params.items()}

    def loss_and_gradients(
        self,
        trace: dict,
        *,
        initial_memory=None,
    ) -> tuple[float, dict[str, np.ndarray], np.ndarray, list[dict]]:
        observations, stages, tools, targets = _validate_trace(trace)
        params = self._tensor_params()
        peripheral = [Tensor(np.zeros(self.PERIPH_HIDDEN)) for _ in range(self.PERIPHERALS)]
        central = Tensor(np.zeros(self.CENTRAL_HIDDEN))
        initial_memory_tensor = Tensor(
            np.zeros((self.MEMORY_SLOTS, self.MEMORY_DIM), dtype=np.float64)
            if initial_memory is None else np.asarray(initial_memory, dtype=np.float64),
            requires_grad=True,
        )
        if initial_memory_tensor.data.shape != (self.MEMORY_SLOTS, self.MEMORY_DIM):
            raise ValueError("invalid initial memory")
        memory = initial_memory_tensor
        traces = []
        total = None
        for tick in range(len(observations)):
            messages = []
            next_peripheral = []
            for brain in range(self.PERIPHERALS):
                prefix = f"p{brain}."
                hidden = tanh(
                    params[prefix + "W_in"] @ Tensor(observations[tick, brain])
                    + params[prefix + "W_rec"] @ peripheral[brain]
                    + params[prefix + "b"]
                )
                message = tanh(params[prefix + "W_msg"] @ hidden + params[prefix + "b_msg"])
                next_peripheral.append(hidden)
                messages.append(message)
            messages_tensor = concatenate(messages, axis=0)
            stage_tensor = Tensor(np.eye(self.STAGE_DIM, dtype=np.float64)[stages[tick]])
            center_input = concatenate((messages_tensor, stage_tensor, Tensor(tools[tick])), axis=0)
            central = tanh(
                params["c.W_in"] @ center_input
                + params["c.W_rec"] @ central
                + params["c.b"]
            )
            key = tanh(params["c.W_key"] @ central)
            read_weights = softmax((memory @ key) / 0.75)
            write_weights = softmax(params["c.W_addr"] @ central)
            write_gate = sigmoid(params["c.w_gate"] @ central + params["c.b_gate"])
            write_value = tanh(params["c.W_value"] @ central + params["c.b_value"])
            memory = memory + write_gate * write_weights.reshape(self.MEMORY_SLOTS, 1) * (
                write_value.reshape(1, self.MEMORY_DIM) - memory
            )
            read_after = write_weights @ memory
            action_features = (read_after + key) if stages[tick] < 2 else read_after
            action_matrix = params["c.W_action_key"] if stages[tick] < 2 else params["c.W_action_memory"]
            action_probs = softmax(action_matrix @ action_features + params["c.b_action"])
            target_vector = np.zeros(self.ACTION_DIM, dtype=np.float64)
            target_vector[targets[tick]] = 1.0
            term = self.STAGE_WEIGHTS[stages[tick]] * (-(Tensor(target_vector) * log(action_probs + 1e-12)).sum())
            total = term if total is None else total + term
            traces.append({"action_probs": action_probs.data.copy(), "memory": memory.data.copy()})
            peripheral = next_peripheral
        total = total / float(len(observations))
        total = total + 0.0005 * (params["c.W_rec"] * params["c.W_rec"]).sum()
        total.backward()
        gradients = {name: tensor.grad.copy() for name, tensor in params.items()}
        return float(total.data), gradients, initial_memory_tensor.grad.copy(), traces

    def train(
        self,
        train_seeds: list[int],
        validation_seeds: list[int],
        *,
        steps: int = 240,
        learning_rate: float = 0.018,
        seed: int = 100,
        validation_every: int = 30,
    ) -> V02TrainResult:
        if not train_seeds or not validation_seeds:
            raise ValueError("train and validation seeds are required")
        from .v02_protocol import teacher_trace

        rng = np.random.default_rng(seed)
        first = {name: np.zeros_like(value) for name, value in self.params.items()}
        second = {name: np.zeros_like(value) for name, value in self.params.items()}
        best_state = self.state_dict()
        best_validation = float("inf")
        best_step = 0
        history = []
        for step in range(1, steps + 1):
            episode_seed = int(train_seeds[int(rng.integers(0, len(train_seeds)))])
            trace = teacher_trace(self, episode_seed)
            loss, gradients, _, _ = self.loss_and_gradients(trace)
            norm = math.sqrt(sum(float(np.sum(value * value)) for value in gradients.values()))
            scale = min(1.0, 3.0 / max(norm, 1e-12))
            for name, gradient in gradients.items():
                gradient = gradient * scale
                first[name] = 0.9 * first[name] + 0.1 * gradient
                second[name] = 0.999 * second[name] + 0.001 * gradient * gradient
                first_hat = first[name] / (1.0 - 0.9**step)
                second_hat = second[name] / (1.0 - 0.999**step)
                self.params[name] -= learning_rate * first_hat / (np.sqrt(second_hat) + 1e-8)
            if step == 1 or step % validation_every == 0 or step == steps:
                validation = [teacher_trace(self, episode_seed) for episode_seed in validation_seeds]
                scores = [self.loss_and_gradients(item)[0] for item in validation]
                accuracies = [
                    np.mean([
                        self.action_from_trace(item_trace) == int(target)
                        for item_trace, target in zip(
                            self._numeric_trace(item), item["targets"]
                        )
                    ])
                    for item in validation
                ]
                validation_loss = float(np.mean(scores))
                validation_accuracy = float(np.mean(accuracies))
                history.append({
                    "step": step,
                    "train_loss": loss,
                    "validation_loss": validation_loss,
                    "validation_accuracy": validation_accuracy,
                    "gradient_norm": norm,
                })
                if validation_loss < best_validation:
                    best_validation = validation_loss
                    best_step = step
                    best_state = self.state_dict()
        self.load_state_dict(best_state)
        return V02TrainResult(self, best_step, best_validation, history, steps)

    def _numeric_trace(self, trace: dict) -> list[dict]:
        runtime = self.initial_runtime()
        output = []
        for observation, stage, tool in zip(trace["observations"], trace["stages"], trace["tools"]):
            runtime, step = self.raw_step(runtime, observation, int(stage), tool)
            output.append(step)
        return output


class V02SingleRecurrentNoMemory:
    """One recurrent controller with matched parameters and no memory state."""

    HIDDEN = 11
    OBS_DIM = 4 * 6 + 3 + 8
    ACTION_DIM = 4
    STAGE_WEIGHTS = (3.0, 1.0, 1.0)

    def __init__(self, seed: int = 41):
        if type(seed) is not int or seed < 0:
            raise ValueError("model seed must be a non-negative integer")
        self.seed = seed
        rng = np.random.default_rng(seed)
        self.params = {
            "W_in": rng.normal(0, 0.25, (self.HIDDEN, self.OBS_DIM)).astype(np.float64),
            "W_rec": rng.normal(0, 0.12, (self.HIDDEN, self.HIDDEN)).astype(np.float64),
            "b": np.zeros(self.HIDDEN, dtype=np.float64),
            "W_action_key": rng.normal(0, 0.35, (self.ACTION_DIM, self.HIDDEN)).astype(np.float64),
            "W_action_memory": rng.normal(0, 0.35, (self.ACTION_DIM, self.HIDDEN)).astype(np.float64),
            "b_action": np.zeros(self.ACTION_DIM, dtype=np.float64),
            "W_port": rng.normal(0, 0.25, (4, 4)).astype(np.float64),
        }

    @property
    def brain_count(self) -> int:
        return 1

    def parameter_count(self) -> int:
        return int(sum(value.size for value in self.params.values()))

    def state_dict(self) -> dict:
        return {name: value.tolist() for name, value in self.params.items()}

    def load_state_dict(self, state: dict) -> None:
        if set(state) != set(self.params):
            raise ValueError("model parameter names do not match")
        for name, current in self.params.items():
            candidate = np.asarray(state[name], dtype=np.float64)
            if candidate.shape != current.shape:
                raise ValueError(f"invalid parameter {name}")
            current[...] = candidate

    def initial_runtime(self, **_) -> dict:
        return {"hidden": np.zeros(self.HIDDEN, dtype=np.float64), "last_tool": np.zeros(8, dtype=np.float64)}

    def raw_step(
        self,
        runtime: dict,
        observations: np.ndarray,
        stage: int,
        tool_vector: np.ndarray | None = None,
        *,
        ablate=None,
        erase_memory_before_action: bool = False,
    ) -> tuple[dict, dict]:
        observations = np.asarray(observations, dtype=np.float64)
        tool = np.zeros(8, dtype=np.float64) if tool_vector is None else np.asarray(tool_vector, dtype=np.float64)
        features = np.concatenate([observations.reshape(-1), np.eye(3)[int(stage)], tool])
        if ablate == "center":
            hidden = np.zeros(self.HIDDEN, dtype=np.float64)
        else:
            hidden = np.tanh(self.params["W_in"] @ features + self.params["W_rec"] @ runtime["hidden"] + self.params["b"])
        action_matrix = self.params["W_action_key"] if int(stage) < 2 else self.params["W_action_memory"]
        logits = action_matrix @ hidden + self.params["b_action"]
        probs = self._softmax(logits)
        drives = np.clip(0.08 * np.tanh(self.params["W_port"] @ hidden[:4]), -0.2, 0.2)
        return {"hidden": hidden, "last_tool": tool.copy()}, {
            "hidden": hidden.copy(),
            "action_logits": logits.copy(),
            "action_probs": probs,
            "port_drives": drives,
        }

    @staticmethod
    def _softmax(value: np.ndarray) -> np.ndarray:
        shifted = np.asarray(value) - np.max(value)
        output = np.exp(shifted)
        return output / output.sum()

    def action_from_trace(self, trace: dict) -> int:
        return int(np.argmax(trace["action_probs"]))

    def loss_and_gradients(self, trace: dict) -> tuple[float, dict[str, np.ndarray], np.ndarray, list[dict]]:
        observations, stages, tools, targets = _validate_trace(trace)
        params = {name: Tensor(value.copy(), requires_grad=True) for name, value in self.params.items()}
        hidden = Tensor(np.zeros(self.HIDDEN))
        total = None
        traces = []
        for tick in range(len(observations)):
            features = np.concatenate([observations[tick].reshape(-1), np.eye(3)[stages[tick]], tools[tick]])
            hidden = tanh(params["W_in"] @ Tensor(features) + params["W_rec"] @ hidden + params["b"])
            action_matrix = params["W_action_key"] if stages[tick] < 2 else params["W_action_memory"]
            probs = softmax(action_matrix @ hidden + params["b_action"])
            target_vector = np.zeros(self.ACTION_DIM, dtype=np.float64)
            target_vector[targets[tick]] = 1.0
            term = self.STAGE_WEIGHTS[stages[tick]] * (-(Tensor(target_vector) * log(probs + 1e-12)).sum())
            total = term if total is None else total + term
            traces.append({"action_probs": probs.data.copy()})
        total = total / float(len(observations))
        total.backward()
        return float(total.data), {name: tensor.grad.copy() for name, tensor in params.items()}, np.zeros((2, 4)), traces

    def train(
        self,
        train_seeds: list[int],
        validation_seeds: list[int],
        *,
        steps: int = 240,
        learning_rate: float = 0.018,
        seed: int = 100,
        validation_every: int = 30,
    ) -> V02TrainResult:
        if not train_seeds or not validation_seeds:
            raise ValueError("train and validation seeds are required")
        from .v02_protocol import teacher_trace

        rng = np.random.default_rng(seed)
        first = {name: np.zeros_like(value) for name, value in self.params.items()}
        second = {name: np.zeros_like(value) for name, value in self.params.items()}
        best_state = self.state_dict()
        best_validation = float("inf")
        best_step = 0
        history = []
        for step in range(1, steps + 1):
            episode_seed = int(train_seeds[int(rng.integers(0, len(train_seeds)))])
            trace = teacher_trace(self, episode_seed)
            loss, gradients, _, _ = self.loss_and_gradients(trace)
            norm = math.sqrt(sum(float(np.sum(value * value)) for value in gradients.values()))
            scale = min(1.0, 3.0 / max(norm, 1e-12))
            for name, gradient in gradients.items():
                gradient = gradient * scale
                first[name] = 0.9 * first[name] + 0.1 * gradient
                second[name] = 0.999 * second[name] + 0.001 * gradient * gradient
                first_hat = first[name] / (1 - 0.9**step)
                second_hat = second[name] / (1 - 0.999**step)
                self.params[name] -= learning_rate * first_hat / (np.sqrt(second_hat) + 1e-8)
            if step == 1 or step % validation_every == 0 or step == steps:
                validation = [teacher_trace(self, item) for item in validation_seeds]
                scores = [self.loss_and_gradients(item)[0] for item in validation]
                accuracies = []
                for item in validation:
                    numeric = []
                    runtime = self.initial_runtime()
                    for observation, stage, tool in zip(item["observations"], item["stages"], item["tools"]):
                        runtime, step_trace = self.raw_step(runtime, observation, int(stage), tool)
                        numeric.append(step_trace)
                    accuracies.append(np.mean([
                        self.action_from_trace(step_trace) == int(target)
                        for step_trace, target in zip(numeric, item["targets"])
                    ]))
                validation_loss = float(np.mean(scores))
                validation_accuracy = float(np.mean(accuracies))
                history.append({"step": step, "train_loss": loss, "validation_loss": validation_loss, "validation_accuracy": validation_accuracy, "gradient_norm": norm})
                if validation_loss < best_validation:
                    best_validation = validation_loss
                    best_step = step
                    best_state = self.state_dict()
        self.load_state_dict(best_state)
        return V02TrainResult(self, best_step, best_validation, history, steps)
