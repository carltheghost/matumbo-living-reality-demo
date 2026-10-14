"""The exact five-brain neural core and its small training loop."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import math

import numpy as np

from .autograd import Tensor, concatenate, exp, log, sigmoid, softmax, tanh


ACTION_NAMES = ("probe_a", "probe_b", "noop")


@dataclass
class TrainResult:
    model: "FiveBrain"
    best_step: int
    best_validation_loss: float
    history: list[dict]
    optimizer_steps: int


class FiveBrain:
    """Four recurrent peripheral brains plus one recurrent memory center."""

    PERIPHERALS = 4
    OBS_DIM = 6
    PERIPH_HIDDEN = 7
    CENTRAL_HIDDEN = 5
    MEMORY_SLOTS = 2
    MEMORY_DIM = 4
    TOOL_DIM = 4
    ACTION_DIM = 3

    def __init__(self, seed: int = 7):
        if type(seed) is not int or seed < 0:
            raise ValueError("model seed must be a non-negative integer")
        self.seed = seed
        rng = np.random.default_rng(seed)
        self.params: dict[str, np.ndarray] = {}

        def normal(name: str, shape: tuple[int, ...], scale: float):
            self.params[name] = rng.normal(0.0, scale, shape).astype(np.float64)

        for brain in range(self.PERIPHERALS):
            normal(f"p{brain}.W_in", (self.PERIPH_HIDDEN, self.OBS_DIM), 0.28)
            normal(f"p{brain}.W_rec", (self.PERIPH_HIDDEN, self.PERIPH_HIDDEN), 0.18)
            self.params[f"p{brain}.b"] = np.zeros(self.PERIPH_HIDDEN, dtype=np.float64)
            normal(f"p{brain}.W_msg", (1, self.PERIPH_HIDDEN), 0.35)
            self.params[f"p{brain}.b_msg"] = np.zeros(1, dtype=np.float64)

        center_input = self.PERIPHERALS + self.TOOL_DIM
        normal("c.W_in", (self.CENTRAL_HIDDEN, center_input), 0.28)
        normal("c.W_rec", (self.CENTRAL_HIDDEN, self.CENTRAL_HIDDEN), 0.12)
        self.params["c.b"] = np.zeros(self.CENTRAL_HIDDEN, dtype=np.float64)
        normal("c.W_key", (self.MEMORY_DIM, self.CENTRAL_HIDDEN), 0.28)
        normal("c.W_addr", (self.MEMORY_SLOTS, self.CENTRAL_HIDDEN), 0.25)
        normal("c.w_gate", (1, self.CENTRAL_HIDDEN), 0.22)
        self.params["c.b_gate"] = np.array([-0.25], dtype=np.float64)
        normal("c.W_value", (self.MEMORY_DIM, self.CENTRAL_HIDDEN), 0.32)
        self.params["c.b_value"] = np.zeros(self.MEMORY_DIM, dtype=np.float64)
        normal("c.W_action", (self.ACTION_DIM, self.MEMORY_DIM), 0.38)
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

    def clone(self) -> "FiveBrain":
        result = FiveBrain(self.seed)
        result.load_state_dict(self.state_dict())
        return result

    def initial_runtime(self, *, memory=None) -> dict:
        return {
            "peripheral": [np.zeros(self.PERIPH_HIDDEN, dtype=np.float64) for _ in range(self.PERIPHERALS)],
            "central": np.zeros(self.CENTRAL_HIDDEN, dtype=np.float64),
            "memory": np.zeros((self.MEMORY_SLOTS, self.MEMORY_DIM), dtype=np.float64)
            if memory is None
            else np.asarray(memory, dtype=np.float64).copy(),
            "last_tool": np.zeros(self.TOOL_DIM, dtype=np.float64),
        }

    def _raw_step(self, runtime: dict, observations: np.ndarray, tool_vector=None) -> tuple[dict, dict]:
        observations = np.asarray(observations, dtype=np.float64)
        if observations.shape != (self.PERIPHERALS, self.OBS_DIM):
            raise ValueError("observations must be four by OBS_DIM")
        tool_vector = np.zeros(self.TOOL_DIM, dtype=np.float64) if tool_vector is None else np.asarray(tool_vector, dtype=np.float64)
        if tool_vector.shape != (self.TOOL_DIM,):
            raise ValueError("invalid typed tool vector")
        messages = []
        new_peripheral = []
        for brain in range(self.PERIPHERALS):
            prefix = f"p{brain}."
            hidden = np.tanh(
                self.params[prefix + "W_in"] @ observations[brain]
                + self.params[prefix + "W_rec"] @ runtime["peripheral"][brain]
                + self.params[prefix + "b"]
            )
            message = np.tanh(self.params[prefix + "W_msg"] @ hidden + self.params[prefix + "b_msg"])[0]
            new_peripheral.append(hidden)
            messages.append(message)
        messages = np.asarray(messages, dtype=np.float64)
        center_input = np.concatenate([messages, tool_vector])
        central = np.tanh(
            self.params["c.W_in"] @ center_input
            + self.params["c.W_rec"] @ runtime["central"]
            + self.params["c.b"]
        )
        key = np.tanh(self.params["c.W_key"] @ central)
        address_scores = (runtime["memory"] @ key) / 0.75
        read_weights = self._softmax(address_scores)
        read = read_weights @ runtime["memory"]
        write_weights = self._softmax(self.params["c.W_addr"] @ central)
        write_gate = float(self._sigmoid(self.params["c.w_gate"] @ central + self.params["c.b_gate"])[0])
        write_value = np.tanh(self.params["c.W_value"] @ central + self.params["c.b_value"])
        memory = runtime["memory"] + write_gate * write_weights[:, None] * (write_value[None, :] - runtime["memory"])
        action_logits = self.params["c.W_action"] @ read + self.params["c.b_action"]
        action_probs = self._softmax(action_logits)
        next_runtime = {
            "peripheral": new_peripheral,
            "central": central,
            "memory": memory,
            "last_tool": tool_vector.copy(),
        }
        trace = {
            "messages": messages,
            "central": central.copy(),
            "memory": memory.copy(),
            "read": read.copy(),
            "read_weights": read_weights.copy(),
            "write_gate": write_gate,
            "write_weights": write_weights.copy(),
            "action_logits": action_logits.copy(),
            "action_probs": action_probs.copy(),
            "port_drives": 0.08 * messages,
        }
        return next_runtime, trace

    @staticmethod
    def _softmax(value):
        value = np.asarray(value, dtype=np.float64)
        shifted = value - np.max(value)
        exp_value = np.exp(shifted)
        return exp_value / np.sum(exp_value)

    @staticmethod
    def _sigmoid(value):
        return 1.0 / (1.0 + np.exp(-np.asarray(value, dtype=np.float64)))

    def run_sequence(
        self,
        observations: np.ndarray,
        *,
        tool_vectors=None,
        runtime: dict | None = None,
        memory_erase_after: int | None = None,
        freeze_observations_after: int | None = None,
        disable_ports: bool = False,
    ) -> tuple[dict, list[dict]]:
        observations = np.asarray(observations, dtype=np.float64)
        if observations.ndim != 3 or observations.shape[1:] != (self.PERIPHERALS, self.OBS_DIM):
            raise ValueError("observations must be T by four by OBS_DIM")
        runtime = self.initial_runtime() if runtime is None else self.copy_runtime(runtime)
        if tool_vectors is None:
            tool_vectors = [None] * len(observations)
        traces = []
        for tick, original in enumerate(observations):
            current = np.zeros_like(original) if freeze_observations_after is not None and tick >= freeze_observations_after else original
            runtime, trace = self._raw_step(runtime, current, tool_vectors[tick])
            if memory_erase_after is not None and tick >= memory_erase_after:
                runtime["memory"].fill(0.0)
                trace["memory_erased"] = True
            if disable_ports:
                trace["port_drives"] = np.zeros(self.PERIPHERALS, dtype=np.float64)
            traces.append(trace)
        return runtime, traces

    @staticmethod
    def copy_runtime(runtime: dict) -> dict:
        return {
            "peripheral": [np.asarray(value, dtype=np.float64).copy() for value in runtime["peripheral"]],
            "central": np.asarray(runtime["central"], dtype=np.float64).copy(),
            "memory": np.asarray(runtime["memory"], dtype=np.float64).copy(),
            "last_tool": np.asarray(runtime.get("last_tool", np.zeros(4)), dtype=np.float64).copy(),
        }

    def action_from_trace(self, trace: dict) -> str:
        return ACTION_NAMES[int(np.argmax(trace["action_probs"]))]

    def brain_snapshot(self, runtime: dict) -> dict:
        return {
            "brain_count": self.brain_count,
            "peripheral": [value.tolist() for value in runtime["peripheral"]],
            "central": runtime["central"].tolist(),
            "memory": runtime["memory"].tolist(),
            "last_tool": runtime.get("last_tool", np.zeros(self.TOOL_DIM)).tolist(),
        }

    def restore_runtime(self, state: dict) -> dict:
        if int(state.get("brain_count", -1)) != self.brain_count:
            raise ValueError("checkpoint does not contain exactly five brains")
        runtime = self.initial_runtime()
        if len(state["peripheral"]) != self.PERIPHERALS:
            raise ValueError("wrong peripheral count")
        runtime["peripheral"] = [
            np.asarray(value, dtype=np.float64).reshape(self.PERIPH_HIDDEN).copy() for value in state["peripheral"]
        ]
        runtime["central"] = np.asarray(state["central"], dtype=np.float64).reshape(self.CENTRAL_HIDDEN).copy()
        runtime["memory"] = np.asarray(state["memory"], dtype=np.float64).reshape(self.MEMORY_SLOTS, self.MEMORY_DIM).copy()
        runtime["last_tool"] = np.asarray(state.get("last_tool", np.zeros(self.TOOL_DIM)), dtype=np.float64).reshape(self.TOOL_DIM).copy()
        if not all(np.isfinite(value).all() for value in runtime["peripheral"] + [runtime["central"], runtime["memory"], runtime["last_tool"]]):
            raise ValueError("non-finite brain state")
        return runtime

    # ---- differentiable training path ---------------------------------

    def _tensor_params(self) -> dict[str, Tensor]:
        return {name: Tensor(value.copy(), requires_grad=True) for name, value in self.params.items()}

    def loss_and_gradients(
        self,
        observations: np.ndarray,
        target: int,
        *,
        tool_vectors=None,
        initial_memory=None,
    ) -> tuple[float, dict[str, np.ndarray], np.ndarray, list[dict]]:
        """Return cross-entropy, parameter grads, initial-memory grad and trace."""

        observations = np.asarray(observations, dtype=np.float64)
        if observations.ndim != 3 or observations.shape[1:] != (self.PERIPHERALS, self.OBS_DIM):
            raise ValueError("invalid observation sequence")
        if type(target) is not int or not 0 <= target < 2:
            raise ValueError("training target must be candidate slot 0 or 1")
        tool_vectors = [None] * len(observations) if tool_vectors is None else tool_vectors
        params = self._tensor_params()
        peripheral = [Tensor(np.zeros(self.PERIPH_HIDDEN)) for _ in range(self.PERIPHERALS)]
        central = Tensor(np.zeros(self.CENTRAL_HIDDEN))
        initial_memory_tensor = Tensor(
            np.zeros((self.MEMORY_SLOTS, self.MEMORY_DIM), dtype=np.float64)
            if initial_memory is None
            else np.asarray(initial_memory, dtype=np.float64),
            requires_grad=True,
        )
        memory = initial_memory_tensor
        traces = []
        for tick, original in enumerate(observations):
            messages = []
            next_peripheral = []
            for brain in range(self.PERIPHERALS):
                prefix = f"p{brain}."
                hidden = tanh(
                    params[prefix + "W_in"] @ Tensor(original[brain])
                    + params[prefix + "W_rec"] @ peripheral[brain]
                    + params[prefix + "b"]
                )
                message = tanh(params[prefix + "W_msg"] @ hidden + params[prefix + "b_msg"])
                next_peripheral.append(hidden)
                messages.append(message)
            messages_tensor = concatenate(messages, axis=0)
            tool = np.zeros(self.TOOL_DIM, dtype=np.float64) if tool_vectors[tick] is None else np.asarray(tool_vectors[tick], dtype=np.float64)
            center_input = concatenate((messages_tensor, Tensor(tool)), axis=0)
            central = tanh(
                params["c.W_in"] @ center_input
                + params["c.W_rec"] @ central
                + params["c.b"]
            )
            key = tanh(params["c.W_key"] @ central)
            read_weights = softmax((memory @ key) / 0.75)
            read = read_weights @ memory
            write_weights = softmax(params["c.W_addr"] @ central)
            write_gate = sigmoid(params["c.w_gate"] @ central + params["c.b_gate"])
            write_value = tanh(params["c.W_value"] @ central + params["c.b_value"])
            memory = memory + write_gate * write_weights.reshape(self.MEMORY_SLOTS, 1) * (
                write_value.reshape(1, self.MEMORY_DIM) - memory
            )
            action_logits = params["c.W_action"] @ read + params["c.b_action"]
            action_probs = softmax(action_logits)
            traces.append(
                {
                    "messages": messages_tensor.data.copy(),
                    "memory": memory.data.copy(),
                    "read": read.data.copy(),
                    "action_probs": action_probs.data.copy(),
                }
            )
            peripheral = next_peripheral

        target_vector = np.zeros(self.ACTION_DIM, dtype=np.float64)
        target_vector[target] = 1.0
        loss = -(Tensor(target_vector) * log(action_probs + 1e-12)).sum()
        # A small recurrent-state penalty prevents the center from becoming a
        # long-lived opaque shortcut; the addressable memory remains the
        # intended delayed-cue path. This is not a privileged target signal.
        loss = loss + 0.0008 * (params["c.W_rec"] * params["c.W_rec"]).sum()
        loss.backward()
        gradients = {name: tensor.grad.copy() for name, tensor in params.items()}
        memory_gradient = (
            initial_memory_tensor.grad.copy()
            if initial_memory_tensor.grad is not None
            else np.zeros_like(initial_memory_tensor.data)
        )
        return float(loss.data), gradients, memory_gradient, traces

    def inference_loss(self, observations: np.ndarray, target: int, **kwargs) -> float:
        _, traces = self.run_sequence(observations, **kwargs)
        probs = traces[-1]["action_probs"]
        return float(-math.log(max(float(probs[target]), 1e-12)))

    def train(
        self,
        train_data: list[tuple[np.ndarray, int]],
        validation_data: list[tuple[np.ndarray, int]],
        *,
        steps: int = 360,
        learning_rate: float = 0.018,
        seed: int = 100,
        validation_every: int = 30,
    ) -> TrainResult:
        if not train_data or not validation_data:
            raise ValueError("train and validation data are required")
        rng = np.random.default_rng(seed)
        first_moment = {name: np.zeros_like(value) for name, value in self.params.items()}
        second_moment = {name: np.zeros_like(value) for name, value in self.params.items()}
        best_state = self.state_dict()
        best_validation = float("inf")
        best_step = 0
        history = []
        for step in range(1, steps + 1):
            observations, target = train_data[int(rng.integers(0, len(train_data)))]
            loss, gradients, _, _ = self.loss_and_gradients(observations, target)
            grad_norm = math.sqrt(sum(float(np.sum(value * value)) for value in gradients.values()))
            scale = min(1.0, 3.0 / max(grad_norm, 1e-12))
            for name, gradient in gradients.items():
                gradient = gradient * scale
                first_moment[name] = 0.9 * first_moment[name] + 0.1 * gradient
                second_moment[name] = 0.999 * second_moment[name] + 0.001 * gradient * gradient
                first_hat = first_moment[name] / (1.0 - 0.9**step)
                second_hat = second_moment[name] / (1.0 - 0.999**step)
                self.params[name] -= learning_rate * first_hat / (np.sqrt(second_hat) + 1e-8)
            if step == 1 or step % validation_every == 0 or step == steps:
                validation_loss = float(
                    np.mean([self.inference_loss(obs, label) for obs, label in validation_data])
                )
                validation_accuracy = float(
                    np.mean(
                        [
                            int(np.argmax(self.run_sequence(obs)[1][-1]["action_probs"])) == label
                            for obs, label in validation_data
                        ]
                    )
                )
                history.append(
                    {
                        "step": step,
                        "train_loss": loss,
                        "validation_loss": validation_loss,
                        "validation_accuracy": validation_accuracy,
                        "gradient_norm": grad_norm,
                    }
                )
                if validation_loss < best_validation:
                    best_validation = validation_loss
                    best_step = step
                    best_state = self.state_dict()
        self.load_state_dict(best_state)
        return TrainResult(self, best_step, best_validation, history, steps)
