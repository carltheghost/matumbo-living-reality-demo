import copy
import json
import unittest

import numpy as np

from vevo_agents.autograd import Tensor
from vevo_agents.v03_hybrid_geometry import (
    BETA_MAX,
    G_MAX,
    G_MIN,
    GEOMETRY_MODEL_VERSION,
    GEOMETRY_SNAPSHOT_SCHEMA,
    GeometryError,
    MAX_COORDINATE_ABS,
    MAX_SAFE_RAW_B_ABS,
    bounded_beta_numeric,
    bounded_beta_tensor,
    bounded_spd_metric_numeric,
    bounded_spd_metric_tensor,
    curvature_upper_bound,
    identity_metric,
    metric_attention_logits_numeric,
    metric_attention_logits_tensor,
    metric_tension_energy_numeric,
    metric_tension_energy_tensor,
    refine_tension_numeric,
    restore_geometry_snapshot,
    serialize_geometry_snapshot,
)


class V03HybridGeometryTests(unittest.TestCase):
    def setUp(self):
        self.raw_B = np.asarray(
            [
                [0.2, -0.1, 0.3, 0.0],
                [0.4, 0.1, -0.2, 0.5],
                [0.0, 0.3, 0.2, -0.4],
                [-0.2, 0.0, 0.1, 0.2],
            ],
            dtype=np.float64,
        )
        self.metric = bounded_spd_metric_numeric(self.raw_B)
        self.query = np.asarray([0.1, -0.2, 0.3, 0.4], dtype=np.float64)
        self.keys = np.asarray(
            [
                [0.1, -0.2, 0.3, 0.4],
                [1.2, -0.7, 0.9, -0.6],
            ],
            dtype=np.float64,
        )
        self.proposals = np.asarray(
            [[0.2, 0.0, -0.1, 0.3], [-0.4, 0.1, 0.5, -0.2]],
            dtype=np.float64,
        )
        self.maps = np.asarray(
            [
                [[0.7, 0.0, 0.1, 0.0], [0.0, 0.6, 0.0, 0.1], [0.1, 0.0, 0.5, 0.0], [0.0, 0.1, 0.0, 0.4]],
                [[0.4, 0.1, 0.0, 0.0], [0.0, 0.5, 0.2, 0.0], [0.0, 0.2, 0.6, 0.1], [0.0, 0.0, 0.1, 0.3]],
            ],
            dtype=np.float64,
        )
        self.alpha = np.asarray([0.8, 0.6], dtype=np.float64)
        self.state = np.asarray([0.8, -0.4, 0.2, 0.1], dtype=np.float64)
        self.prior = np.asarray([0.0, 0.0, 0.0, 0.0], dtype=np.float64)

    def test_exact_formula_symmetry_and_eigenbounds(self):
        expected = G_MIN * np.eye(4) + (G_MAX - G_MIN) * (self.raw_B.T @ self.raw_B) / (1.0 + np.sum(self.raw_B * self.raw_B))
        np.testing.assert_allclose(self.metric, expected, rtol=1e-14, atol=1e-14)
        np.testing.assert_allclose(self.metric, self.metric.T, rtol=0.0, atol=1e-14)
        eigenvalues = np.linalg.eigvalsh(self.metric)
        self.assertGreaterEqual(float(eigenvalues.min()), G_MIN - 1e-12)
        self.assertLessEqual(float(eigenvalues.max()), G_MAX + 1e-12)
        np.testing.assert_allclose(bounded_spd_metric_numeric(np.zeros((4, 4))), G_MIN * np.eye(4))

    def test_numeric_tensor_metric_parity_and_gradients(self):
        raw_tensor = Tensor(self.raw_B, requires_grad=True)
        tensor_metric = bounded_spd_metric_tensor(raw_tensor)
        np.testing.assert_allclose(self.metric, tensor_metric.data, rtol=1e-12, atol=1e-12)
        loss = (tensor_metric * tensor_metric).sum()
        loss.backward()
        self.assertTrue(np.isfinite(raw_tensor.grad).all())
        self.assertGreater(float(np.linalg.norm(raw_tensor.grad)), 0.0)

    def test_extreme_accepted_raw_metric_has_finite_forward_and_backward(self):
        raw = np.full((4, 4), MAX_SAFE_RAW_B_ABS * 0.99, dtype=np.float64)
        numeric = bounded_spd_metric_numeric(raw)
        self.assertTrue(np.isfinite(numeric).all())
        raw_tensor = Tensor(raw, requires_grad=True)
        tensor_metric = bounded_spd_metric_tensor(raw_tensor)
        self.assertTrue(np.isfinite(tensor_metric.data).all())
        (tensor_metric * tensor_metric).sum().backward()
        self.assertTrue(np.isfinite(raw_tensor.grad).all())

    def test_bounded_beta_and_gradient(self):
        self.assertGreaterEqual(bounded_beta_numeric(-100.0), 0.0)
        self.assertLessEqual(bounded_beta_numeric(100.0), BETA_MAX)
        with self.assertRaises(GeometryError):
            bounded_beta_numeric(np.asarray(True))
        raw_beta = Tensor(0.3, requires_grad=True)
        beta = bounded_beta_tensor(raw_beta)
        self.assertGreater(float(beta.data), 0.0)
        self.assertLess(float(beta.data), BETA_MAX)
        (beta * beta).backward()
        self.assertTrue(np.isfinite(raw_beta.grad).all())
        self.assertGreater(float(np.linalg.norm(raw_beta.grad)), 0.0)

    def test_attention_metric_distance_and_no_distance_ablation(self):
        base = np.asarray([0.0, 0.0], dtype=np.float64)
        logits = metric_attention_logits_numeric(self.query, self.keys, self.metric, 0.0, base)
        self.assertAlmostEqual(float(logits[0]), 0.0, places=14)
        self.assertLess(float(logits[1]), float(logits[0]))
        np.testing.assert_array_equal(
            metric_attention_logits_numeric(
                self.query,
                self.keys,
                self.metric,
                0.0,
                base,
                distance_enabled=False,
            ),
            base,
        )
        identity_logits = metric_attention_logits_numeric(self.query, self.keys, identity_metric(), 0.0, base)
        self.assertNotEqual(float(identity_logits[1]), float(logits[1]))

    def test_attention_tensor_parity_and_gradients(self):
        raw_beta = 0.2
        base = np.asarray([0.3, -0.1], dtype=np.float64)
        numeric = metric_attention_logits_numeric(self.query, self.keys, self.metric, raw_beta, base)
        tensor_metric = Tensor(self.metric, requires_grad=True)
        tensor_beta = Tensor(raw_beta, requires_grad=True)
        tensor = metric_attention_logits_tensor(
            Tensor(self.query),
            Tensor(self.keys),
            tensor_metric,
            tensor_beta,
            Tensor(base),
        )
        np.testing.assert_allclose(numeric, tensor.data, rtol=1e-12, atol=1e-12)
        (tensor * tensor).sum().backward()
        self.assertTrue(np.isfinite(tensor_metric.grad).all())
        self.assertTrue(np.isfinite(tensor_beta.grad).all())
        self.assertGreater(float(np.linalg.norm(tensor_metric.grad)), 0.0)

    def test_attention_rejects_boolean_logits_and_unbounded_tensor_coordinates(self):
        with self.assertRaises(GeometryError):
            metric_attention_logits_numeric(
                self.query,
                self.keys,
                self.metric,
                0.0,
                np.asarray(True),
            )
        with self.assertRaises(GeometryError):
            metric_attention_logits_numeric(
                self.query,
                self.keys,
                self.metric,
                0.0,
                np.asarray([True, False]),
            )
        with self.assertRaises(GeometryError):
            metric_attention_logits_tensor(
                Tensor(np.full(4, MAX_COORDINATE_ABS + 1.0)),
                Tensor(self.keys),
                Tensor(self.metric),
                Tensor(0.0),
            )
        with self.assertRaises(GeometryError):
            metric_attention_logits_tensor(
                Tensor(self.query),
                Tensor(np.vstack((self.keys, np.full(4, MAX_COORDINATE_ABS + 1.0)))),
                Tensor(self.metric),
                Tensor(0.0),
            )

    def test_tension_energy_parity_and_gradients(self):
        numeric = metric_tension_energy_numeric(
            self.state, self.proposals, self.maps, self.alpha, 0.4, self.prior, self.metric
        )
        state = Tensor(self.state, requires_grad=True)
        proposals = Tensor(self.proposals, requires_grad=True)
        maps = Tensor(self.maps, requires_grad=True)
        alpha = Tensor(self.alpha, requires_grad=True)
        prior = Tensor(self.prior, requires_grad=True)
        metric = Tensor(self.metric, requires_grad=True)
        tensor = metric_tension_energy_tensor(state, proposals, maps, alpha, 0.4, prior, metric)
        self.assertAlmostEqual(float(tensor.data), numeric, places=12)
        tensor.backward()
        for parameter in (state, proposals, maps, alpha, prior, metric):
            self.assertTrue(np.isfinite(parameter.grad).all())
        self.assertGreater(float(np.linalg.norm(metric.grad)), 0.0)

    def test_tensor_tension_rejects_unbounded_proposals_like_numeric_path(self):
        with self.assertRaises(GeometryError):
            metric_tension_energy_tensor(
                Tensor(self.state),
                Tensor(np.full_like(self.proposals, MAX_COORDINATE_ABS + 1.0)),
                Tensor(self.maps),
                Tensor(self.alpha),
                0.4,
                Tensor(self.prior),
                Tensor(self.metric),
            )

    def test_curvature_bound_and_frozen_projected_refinement(self):
        expected_bound = G_MAX * float(np.sum(self.alpha * np.sum(self.maps * self.maps, axis=(1, 2)))) + 0.4
        self.assertAlmostEqual(curvature_upper_bound(self.maps, self.alpha, 0.4), expected_bound, places=14)
        original = (self.state.copy(), self.proposals.copy(), self.maps.copy(), self.alpha.copy(), self.prior.copy())
        refined, trace = refine_tension_numeric(
            self.state,
            self.proposals,
            self.maps,
            self.alpha,
            0.4,
            self.prior,
            self.metric,
            steps=5,
        )
        self.assertTrue(trace.objective_frozen)
        self.assertEqual(len(trace.energies), 6)
        self.assertTrue(np.all(np.diff(trace.energies) <= 1e-10))
        self.assertLessEqual(float(np.linalg.norm(refined)), 2.0 + 1e-12)
        np.testing.assert_array_equal(self.state, original[0])
        np.testing.assert_array_equal(self.proposals, original[1])
        np.testing.assert_array_equal(self.maps, original[2])
        np.testing.assert_array_equal(self.alpha, original[3])
        np.testing.assert_array_equal(self.prior, original[4])

    def test_identity_and_invalid_metric_inputs(self):
        identity = identity_metric()
        np.testing.assert_array_equal(identity, np.eye(4))
        energy_identity = metric_tension_energy_numeric(
            self.state, self.proposals, self.maps, self.alpha, 0.4, self.prior, identity
        )
        self.assertTrue(np.isfinite(energy_identity))
        with self.assertRaises(GeometryError):
            bounded_spd_metric_numeric(np.ones((3, 3)))
        with self.assertRaises(GeometryError):
            metric_tension_energy_numeric(
                self.state, self.proposals, self.maps, self.alpha, -0.1, self.prior, self.metric
            )
        asymmetric = identity.copy()
        asymmetric[0, 1] = 0.2
        with self.assertRaises(GeometryError):
            metric_tension_energy_numeric(
                self.state, self.proposals, self.maps, self.alpha, 0.4, self.prior, asymmetric
            )

    def test_unsafe_raw_metric_coordinates_and_boolean_arrays_fail_before_arithmetic(self):
        with self.assertRaises(GeometryError):
            bounded_spd_metric_numeric(np.full((4, 4), 1.0e200))
        with self.assertRaises(GeometryError):
            bounded_spd_metric_tensor(Tensor(np.full((4, 4), 1.0e200)))
        with self.assertRaises(GeometryError):
            bounded_spd_metric_numeric(np.ones((4, 4), dtype=bool))
        with self.assertRaises(GeometryError):
            metric_attention_logits_numeric(self.query, np.asarray(self.keys, dtype=bool), self.metric, 0.0)
        with self.assertRaises(GeometryError):
            metric_attention_logits_numeric(np.full(4, 1.0e6), self.keys, self.metric, 0.0)

    def test_dynamic_center_maps_and_count_mismatch_are_validated(self):
        state = np.linspace(-0.3, 0.3, 12)
        prior = np.zeros(12)
        maps = np.zeros((2, 4, 12))
        maps[0, :, :4] = self.maps[0]
        maps[1, :, :4] = self.maps[1]
        energy = metric_tension_energy_numeric(
            state, self.proposals, maps, self.alpha, 0.4, prior, self.metric
        )
        self.assertTrue(np.isfinite(energy))
        refined, trace = refine_tension_numeric(
            state, self.proposals, maps, self.alpha, 0.4, prior, self.metric, steps=2
        )
        self.assertEqual(refined.shape, (12,))
        self.assertEqual(len(trace.states), 3)
        with self.assertRaises(GeometryError):
            metric_tension_energy_numeric(
                state, self.proposals[:1], maps, self.alpha, 0.4, prior, self.metric
            )
        with self.assertRaises(GeometryError):
            metric_tension_energy_numeric(
                state, self.proposals, np.asarray(maps, dtype=bool), self.alpha, 0.4, prior, self.metric
            )

    def test_snapshot_roundtrip_and_version_checks(self):
        encoded = serialize_geometry_snapshot(self.raw_B, 0.25)
        snapshot = restore_geometry_snapshot(encoded)
        self.assertEqual(snapshot.schema, GEOMETRY_SNAPSHOT_SCHEMA)
        self.assertEqual(snapshot.model_version, GEOMETRY_MODEL_VERSION)
        np.testing.assert_array_equal(snapshot.raw_B, self.raw_B)
        self.assertEqual(snapshot.raw_beta, 0.25)
        mapping = json.loads(encoded)
        for key, value in (("schema", "wrong"), ("model_version", "wrong"), ("g_min", 0.4)):
            broken = copy.deepcopy(mapping)
            broken[key] = value
            with self.subTest(key=key), self.assertRaises(Exception):
                restore_geometry_snapshot(broken)
        broken_shape = copy.deepcopy(mapping)
        broken_shape["raw_B"] = [[0.0]]
        with self.assertRaises(Exception):
            restore_geometry_snapshot(broken_shape)


if __name__ == "__main__":
    unittest.main()
