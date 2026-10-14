"""Equal-budget comparison controls for the delayed-cue proof."""

from __future__ import annotations

import math

import numpy as np

from .autograd import Tensor, log, softmax, tanh
from .model import ACTION_NAMES


class SingleRecurrentNoMemory:
    """One recurrent brain, parameter-matched and with no external memory."""

    HIDDEN = 14
    OBS_DIM = 4 * 6
    ACTION_DIM = 3

    def __init__(self, seed: int = 19):
        rng = np.random.default_rng(seed)
        self.seed = seed
        self.params = {
            "W_in": rng.normal(0, 0.25, (self.HIDDEN, self.OBS_DIM)),
            "W_rec": rng.normal(0, 0.12, (self.HIDDEN, self.HIDDEN)),
            "b": np.zeros(self.HIDDEN),
            "W_action": rng.normal(0, 0.35, (self.ACTION_DIM, self.HIDDEN)),
            "b_action": np.zeros(self.ACTION_DIM),
        }

    def parameter_count(self) -> int:
        return int(sum(value.size for value in self.params.values()))

    def _step(self, hidden, observation):
        flat = np.asarray(observation, dtype=np.float64).reshape(-1)
        hidden = np.tanh(self.params["W_in"] @ flat + self.params["W_rec"] @ hidden + self.params["b"])
        logits = self.params["W_action"] @ hidden + self.params["b_action"]
        shifted = logits - np.max(logits)
        probs = np.exp(shifted)
        probs /= probs.sum()
        return hidden, logits, probs

    def run_sequence(self, observations):
        hidden = np.zeros(self.HIDDEN)
        traces = []
        for observation in observations:
            hidden, logits, probs = self._step(hidden, observation)
            traces.append({"hidden": hidden.copy(), "action_logits": logits.copy(), "action_probs": probs.copy()})
        return hidden, traces

    def loss_and_gradients(self, observations, target):
        observations = np.asarray(observations, dtype=np.float64)
        params = {name: Tensor(value.copy(), requires_grad=True) for name, value in self.params.items()}
        hidden = Tensor(np.zeros(self.HIDDEN))
        final_probs = None
        for observation in observations:
            hidden = tanh(params["W_in"] @ Tensor(observation.reshape(-1)) + params["W_rec"] @ hidden + params["b"])
            logits = params["W_action"] @ hidden + params["b_action"]
            final_probs = softmax(logits)
        target_vector = np.zeros(self.ACTION_DIM)
        target_vector[target] = 1.0
        loss = -(Tensor(target_vector) * log(final_probs + 1e-12)).sum()
        loss.backward()
        return float(loss.data), {name: tensor.grad.copy() for name, tensor in params.items()}

    def train(self, train_data, validation_data, *, steps=360, learning_rate=0.018, seed=100):
        rng = np.random.default_rng(seed)
        first = {name: np.zeros_like(value) for name, value in self.params.items()}
        second = {name: np.zeros_like(value) for name, value in self.params.items()}
        best = {name: value.copy() for name, value in self.params.items()}
        best_loss = float("inf")
        best_step = 0
        history = []
        for step in range(1, steps + 1):
            obs, target = train_data[int(rng.integers(0, len(train_data)))]
            loss, gradients = self.loss_and_gradients(obs, target)
            norm = math.sqrt(sum(float(np.sum(value * value)) for value in gradients.values()))
            scale = min(1.0, 3.0 / max(norm, 1e-12))
            for name, gradient in gradients.items():
                gradient *= scale
                first[name] = 0.9 * first[name] + 0.1 * gradient
                second[name] = 0.999 * second[name] + 0.001 * gradient * gradient
                first_hat = first[name] / (1 - 0.9**step)
                second_hat = second[name] / (1 - 0.999**step)
                self.params[name] -= learning_rate * first_hat / (np.sqrt(second_hat) + 1e-8)
            if step == 1 or step % 60 == 0 or step == steps:
                validation_loss = float(np.mean([-math.log(max(self.run_sequence(obs)[1][-1]["action_probs"][label], 1e-12)) for obs, label in validation_data]))
                history.append({"step": step, "validation_loss": validation_loss})
                if validation_loss < best_loss:
                    best_loss = validation_loss
                    best_step = step
                    best = {name: value.copy() for name, value in self.params.items()}
        for name, value in best.items():
            self.params[name][...] = value
        return {"best_step": best_step, "best_validation_loss": best_loss, "history": history, "optimizer_steps": steps}

    def action(self, observations):
        return ACTION_NAMES[int(np.argmax(self.run_sequence(observations)[1][-1]["action_probs"]))]
