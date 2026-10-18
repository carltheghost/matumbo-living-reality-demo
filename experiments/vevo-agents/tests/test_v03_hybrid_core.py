import copy
import math
import unittest

import numpy as np

from vevo_agents.v03_hybrid_core import (
    DEFAULT_DT,
    INCREMENTAL_PARAMETER_CAP,
    MAX_SUPPORTED_DT,
    REFINEMENT_STEPS,
    TENSION_STATE_RADIUS,
    V03HybridCore,
    HybridCoreSnapshotError,
    advance_oscillator,
)


class V03HybridCoreTests(unittest.TestCase):
    @staticmethod
    def _vectors(seed=31, count=2):
        rng = np.random.default_rng(seed)
        return [rng.normal(0.0, 0.2, 178) for _ in range(count)]

    def _assert_runtime_close(self, left, right):
        for key in ("central", "memory", "oscillators", "feedback"):
            np.testing.assert_allclose(left[key], right[key], rtol=1e-12, atol=1e-12)
        for left_value, right_value in zip(left["peripheral"], right["peripheral"]):
            np.testing.assert_allclose(left_value, right_value, rtol=1e-12, atol=1e-12)
        self.assertEqual(left["step"], right["step"])
        self.assertEqual(left["time"], right["time"])
        np.testing.assert_array_equal(left["module_presence"], right["module_presence"])
        np.testing.assert_array_equal(left["memory_presence"], right["memory_presence"])

    def test_backbone_dimensions_and_incremental_budget(self):
        core = V03HybridCore(17)
        audit = core.parameter_budget_audit()
        self.assertEqual(core.brain_count, 5)
        self.assertEqual(core.base.PERIPH_HIDDEN, 8)
        self.assertEqual(core.base.CENTER_HIDDEN, 12)
        self.assertEqual(core.base.central_memory_shape, (2, 6))
        self.assertEqual(audit["incremental_parameter_count"], 1181)
        self.assertLessEqual(audit["incremental_parameter_count"], INCREMENTAL_PARAMETER_CAP)
        self.assertTrue(audit["within_cap"])
        self.assertEqual(core.model_identity()["weights_status"], "random_untrained")
        self.assertFalse(core.model_identity()["competence_claim"])

    def test_oscillator_dt_zero_decay_and_small_dt_validation(self):
        z = np.asarray([0.6, -0.8], dtype=np.float64)
        forcing = np.asarray([2.0, -1.0], dtype=np.float64)
        np.testing.assert_array_equal(advance_oscillator(z, forcing, 0.7, 1.2, 0.0), z)
        decayed = advance_oscillator(np.asarray([1.0, 0.0]), np.zeros(2), 0.7, 0.0, 0.1)
        self.assertAlmostEqual(decayed[0], math.exp(-0.07), places=14)
        self.assertAlmostEqual(decayed[1], 0.0, places=14)
        tiny = advance_oscillator(z, forcing, 0.7, 1.2, 1.0e-8)
        self.assertTrue(np.isfinite(tiny).all())
        with self.assertRaises(ValueError):
            advance_oscillator(z, forcing, 0.7, 1.2, -1.0e-6)
        with self.assertRaises(ValueError):
            advance_oscillator(z, forcing, 0.7, 1.2, MAX_SUPPORTED_DT + 1.0e-6)

    def test_oscillator_split_step_composition_and_unit_ball_bound(self):
        z = np.asarray([0.3, -0.4], dtype=np.float64)
        forcing = np.asarray([0.5, 0.2], dtype=np.float64)
        whole = advance_oscillator(z, forcing, 0.7, 1.2, 0.16)
        split = advance_oscillator(
            advance_oscillator(z, forcing, 0.7, 1.2, 0.07),
            forcing,
            0.7,
            1.2,
            0.09,
        )
        np.testing.assert_allclose(whole, split, rtol=1e-12, atol=1e-12)
        rng = np.random.default_rng(9)
        max_norm = 0.0
        for _ in range(300):
            initial = rng.normal(size=2)
            initial /= max(1.0, np.linalg.norm(initial))
            result = advance_oscillator(
                initial,
                rng.normal(size=2),
                float(rng.uniform(0.05, 1.5)),
                float(rng.uniform(-3.0, 3.0)),
                float(rng.uniform(0.0, MAX_SUPPORTED_DT)),
            )
            max_norm = max(max_norm, float(np.linalg.norm(result)))
        self.assertLessEqual(max_norm, 1.0 + 1e-10)

    def test_attention_masks_and_legal_message_influence(self):
        core = V03HybridCore(19)
        rng = np.random.default_rng(4)
        messages = rng.normal(size=(4, 4))
        memory = rng.normal(size=(2, 6))
        central = rng.normal(size=12)
        module_presence = np.asarray([1.0, 0.0, 0.0, 0.0])
        memory_presence = np.asarray([0.0, 0.0])
        first = core._attention_numeric(
            messages, memory, central, module_presence, memory_presence, core.params
        )
        altered_absent = messages.copy()
        altered_absent[1:] += 100.0
        second = core._attention_numeric(
            altered_absent, memory, central, module_presence, memory_presence, core.params
        )
        np.testing.assert_allclose(first["context"], second["context"], rtol=1e-12, atol=1e-12)
        self.assertTrue(np.all(first["weights"][1:] == 0.0))
        altered_legal = messages.copy()
        altered_legal[0] += 0.5
        third = core._attention_numeric(
            altered_legal, memory, central, module_presence, memory_presence, core.params
        )
        self.assertGreater(float(np.linalg.norm(first["context"] - third["context"])), 0.0)
        self.assertLessEqual(float(np.max(np.abs(first["query"]))), 1.0)
        self.assertLessEqual(float(np.max(np.abs(first["keys"]))), 1.0)
        self.assertLessEqual(float(np.max(np.abs(first["values"]))), 1.0)

    def test_tension_analytic_gradient_and_fixed_objective_nonincrease(self):
        core = V03HybridCore(23)
        rng = np.random.default_rng(5)
        proposals = rng.normal(0.0, 0.4, size=(4, 4))
        initial = rng.normal(0.0, 0.7, size=12)
        refined, trace = core.refine_tension(proposals, initial)
        energies = np.asarray(trace["energies"], dtype=np.float64)
        self.assertEqual(len(energies), REFINEMENT_STEPS + 1)
        self.assertTrue(np.all(np.diff(energies) <= 1e-10))
        self.assertLessEqual(float(np.linalg.norm(refined)), TENSION_STATE_RADIUS + 1e-10)
        coefficients = trace["objective_coefficients"]
        coordinate = 3
        epsilon = 1e-6
        plus_state = initial.copy()
        plus_state[coordinate] += epsilon
        minus_state = initial.copy()
        minus_state[coordinate] -= epsilon
        plus = core._tension_energy_numeric(plus_state, proposals, coefficients)
        minus = core._tension_energy_numeric(minus_state, proposals, coefficients)
        finite_difference = (plus - minus) / (2.0 * epsilon)
        analytic = core._tension_gradient_numeric(initial, proposals, coefficients)[coordinate]
        self.assertAlmostEqual(float(analytic), float(finite_difference), places=6)

    def test_numeric_tensor_parity_and_feedback_shapes(self):
        core = V03HybridCore(29)
        vector = self._vectors(30, 1)[0]
        module_presence = np.asarray([1.0, 0.0, 1.0, 1.0])
        memory_presence = np.asarray([1.0, 0.0])
        numeric_runtime, numeric_trace = core.step(
            core.initial_runtime(),
            vector,
            dt=DEFAULT_DT,
            module_presence=module_presence,
            memory_presence=memory_presence,
        )
        tensor_runtime, tensor_trace = core.tensor_step(
            core.tensor_initial_runtime(),
            vector,
            dt=DEFAULT_DT,
            module_presence=module_presence,
            memory_presence=memory_presence,
            params=core.tensor_parameters(requires_grad=False),
        )
        np.testing.assert_allclose(numeric_runtime["central"], tensor_runtime["central"].data, rtol=1e-12, atol=1e-12)
        np.testing.assert_allclose(numeric_runtime["memory"], tensor_runtime["memory"].data, rtol=1e-12, atol=1e-12)
        np.testing.assert_allclose(numeric_runtime["oscillators"], tensor_runtime["oscillators"].data, rtol=1e-12, atol=1e-12)
        np.testing.assert_allclose(numeric_runtime["feedback"], tensor_runtime["feedback"].data, rtol=1e-12, atol=1e-12)
        np.testing.assert_allclose(
            numeric_trace["attention"]["context"],
            tensor_trace["attention"]["context"].data,
            rtol=1e-12,
            atol=1e-12,
        )
        np.testing.assert_allclose(
            numeric_trace["attention"]["weights"],
            tensor_trace["attention"]["weights"].data,
            rtol=1e-12,
            atol=1e-12,
        )
        np.testing.assert_allclose(
            numeric_trace["tension_refined"],
            tensor_trace["tension_refined"].data,
            rtol=1e-12,
            atol=1e-12,
        )
        self.assertEqual(numeric_trace["messages"].shape, (5, 4))
        self.assertEqual(numeric_trace["attention"]["weights"].shape, (6,))
        self.assertEqual(numeric_runtime["feedback"].shape, (5, 4))

    def test_gradient_probe_reaches_frequency_damping_attention_tension_and_memory(self):
        core = V03HybridCore(37)
        vectors = self._vectors(38, 2)
        _, gradients, _ = core.loss_and_gradients(vectors)
        probes = [
            ("h.oscillator_omega_raw", (0, 0)),
            ("h.oscillator_gamma_raw", (0, 0)),
            ("h.W_query", (0, 0)),
            ("h.W_tension_0", (0, 0)),
            ("base.c.W_value", (0, 0)),
        ]
        for name, index in probes:
            with self.subTest(name=name):
                self.assertGreater(abs(float(gradients[name][index])), 0.0)
                target = core.base.params[name[5:]] if name.startswith("base.") else core.params[name]
                original = float(target[index])
                epsilon = 1e-6
                target[index] = original + epsilon
                plus = core.loss_only(vectors)
                target[index] = original - epsilon
                minus = core.loss_only(vectors)
                target[index] = original
                finite_difference = (plus - minus) / (2.0 * epsilon)
                self.assertAlmostEqual(
                    float(gradients[name][index]),
                    float(finite_difference),
                    places=5,
                )

    def test_state_isolation_snapshot_and_next_step_parity(self):
        core = V03HybridCore(41)
        first_vector, second_vector = self._vectors(42, 2)
        runtime = core.initial_runtime()
        original = copy.deepcopy(runtime)
        first_runtime, first_trace = core.step(runtime, first_vector)
        self._assert_runtime_close(runtime, original)
        snapshot = core.snapshot_runtime(first_runtime)
        restored = core.restore_runtime(snapshot)
        next_a, trace_a = core.step(first_runtime, second_vector)
        next_b, trace_b = core.step(restored, second_vector)
        self._assert_runtime_close(next_a, next_b)
        np.testing.assert_allclose(trace_a["attention"]["context"], trace_b["attention"]["context"], rtol=1e-12, atol=1e-12)
        np.testing.assert_allclose(trace_a["feedback"], trace_b["feedback"], rtol=1e-12, atol=1e-12)
        self.assertEqual(snapshot["model_version"], core.model_identity()["model_version"])
        self.assertEqual(snapshot["parameter_digest"], core.parameter_digest())
        core.params["h.W_query"][0, 0] += 1e-8
        with self.assertRaises(HybridCoreSnapshotError):
            core.restore_runtime(snapshot)

    def test_feedback_is_causal_and_dt_is_validated(self):
        core = V03HybridCore(43)
        vector = self._vectors(44, 1)[0]
        first, _ = core.step(core.initial_runtime(), vector)
        no_feedback = copy.deepcopy(first)
        no_feedback["feedback"][:] = 0.0
        with_feedback, _ = core.step(first, vector)
        without_feedback, _ = core.step(no_feedback, vector)
        self.assertGreater(float(np.linalg.norm(with_feedback["central"] - without_feedback["central"])), 0.0)
        with self.assertRaises(ValueError):
            core.step(core.initial_runtime(), vector, dt=-0.01)
        with self.assertRaises(ValueError):
            core.step(core.initial_runtime(), vector, dt=MAX_SUPPORTED_DT + 0.01)


if __name__ == "__main__":
    unittest.main()
