import json
import unittest
from unittest.mock import patch

from vevo_agents.v03_specialist_interface import (
    LocalSpecialistRegistry,
    ResourceEstimate,
    SpecialistCapability,
    SpecialistRequest,
    SystemResourceBudget,
    check_system_budget,
)
from vevo_agents.v03_tool_synthesis import (
    DEFAULT_RESOURCE_LIMITS,
    ExecutionResult,
    ResourceLimitError,
    ResourceLimits,
    SpecParseError,
    TOOL_SYNTHESIS_OUTPUT_SCHEMA,
    TypeValidationError,
    execute,
    parse_spec,
    serialize_spec,
)
from vevo_agents.v03_tool_synthesis_verifier import (
    DEVELOPMENT_GOLD_CASES,
    DEVELOPMENT_SPEC_DOCUMENT,
    development_spec,
    verify_gold_cases,
)


class V03ToolSynthesisTests(unittest.TestCase):
    def setUp(self):
        self.spec = development_spec()

    def test_ast_round_trip_and_typed_pointer_identity(self):
        encoded = serialize_spec(self.spec)
        decoded = parse_spec(encoded)
        self.assertEqual(decoded, self.spec)
        self.assertIn(b'"kind":"field"', encoded)
        self.assertIn(b'"kind":"constant"', encoded)
        renamed = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        renamed["constants"]["threshold_renamed"] = renamed["constants"].pop("threshold")
        with self.assertRaises(SpecParseError):
            parse_spec(json.dumps(renamed))

    def test_filter_project_derive_preserves_duplicates_and_output_completeness(self):
        result = execute(
            self.spec,
            DEVELOPMENT_GOLD_CASES[0].input_table,
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(result.output_table["schema"], TOOL_SYNTHESIS_OUTPUT_SCHEMA)
        self.assertEqual(result.output_table["columns"], ["id", "adjusted"])
        self.assertEqual(
            result.output_table["rows"],
            [{"id": "a", "adjusted": 4}, {"id": "a", "adjusted": 4}],
        )
        self.assertNotIn("score", result.output_table["columns"])
        self.assertEqual(result.output_table["rows"][0].keys(), {"id", "adjusted"})

    def test_empty_table_has_explicit_schema_without_fabricated_rows(self):
        result = execute(self.spec, DEVELOPMENT_GOLD_CASES[1].input_table)
        self.assertEqual(result.status, "success")
        self.assertEqual(result.output_table["columns"], ["id", "adjusted"])
        self.assertEqual(result.output_table["rows"], [])

    def test_missing_field_and_type_errors_are_failures(self):
        missing = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        missing["operations"][0]["left"]["name"] = "missing_score"
        missing_result = execute(parse_spec(json.dumps(missing)), DEVELOPMENT_GOLD_CASES[0].input_table)
        self.assertEqual(missing_result.status, "failure")
        self.assertEqual(missing_result.error["code"], "missing_field")

        invalid_type = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        invalid_type["operations"][0]["operator"] = "gt"
        invalid_type_result = execute(
            parse_spec(json.dumps(invalid_type)),
            {
                "schema": "vevo.v03.tool-synthesis.table.v1",
                "columns": ["id", "score", "label"],
                "rows": [{"id": "a", "score": "three", "label": "keep"}],
            },
        )
        self.assertEqual(invalid_type_result.status, "failure")
        self.assertEqual(invalid_type_result.error["code"], "type_error")

        division = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        division["operations"][2]["operator"] = "div"
        division["constants"]["bonus"] = 0
        division_result = execute(
            parse_spec(json.dumps(division)),
            DEVELOPMENT_GOLD_CASES[0].input_table,
        )
        self.assertEqual(division_result.status, "failure")
        self.assertEqual(division_result.error["code"], "numeric_error")

    def test_duplicate_keys_unknown_language_and_invalid_constants_reject(self):
        duplicate = (
            '{"schema":"vevo.v03.tool-synthesis.spec.v1","version":1,'
            '"name":"x","constants":{},"constants":{},"operations":[]}'
        )
        with self.assertRaises(SpecParseError):
            parse_spec(duplicate)

        unknown = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        unknown["operations"][0] = {"op": "eval", "expression": "__import__('os')"}
        with self.assertRaises(Exception):
            parse_spec(json.dumps(unknown))

        nested = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        nested["constants"]["bad"] = {"path": "/tmp"}
        with self.assertRaises(Exception):
            parse_spec(json.dumps(nested))

        nonfinite = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        nonfinite["constants"]["bad"] = float("nan")
        with self.assertRaises(Exception):
            parse_spec(json.dumps(nonfinite))

    def test_independent_resource_caps_fail_without_truncation(self):
        cases = (
            (ResourceLimits(max_input_bytes=1), "input_bytes"),
            (ResourceLimits(max_input_tokens=1), "input_tokens"),
            (ResourceLimits(max_spec_bytes=1), "spec_bytes"),
            (ResourceLimits(max_spec_tokens=1), "spec_tokens"),
            (ResourceLimits(max_literals=1), "literal_count"),
            (ResourceLimits(max_literal_bytes=1), "literal_bytes"),
            (ResourceLimits(max_ast_nodes=1), "ast_nodes"),
            (ResourceLimits(max_steps=1), "steps"),
            (ResourceLimits(max_output_bytes=1), "output_bytes"),
        )
        for limits, resource in cases:
            with self.subTest(resource=resource):
                result = execute(self.spec, DEVELOPMENT_GOLD_CASES[0].input_table, limits)
                self.assertEqual(result.status, "failure")
                self.assertEqual(result.error["code"], "resource_limit")
                self.assertEqual(result.error["context"]["resource"], resource)
                self.assertIsNone(result.output_table)
                self.assertIsNone(result.output_bytes)

    def test_serialized_output_is_complete_and_deterministic(self):
        first = execute(self.spec, DEVELOPMENT_GOLD_CASES[0].input_table)
        second = execute(self.spec, DEVELOPMENT_GOLD_CASES[0].input_table)
        self.assertEqual(first.output_bytes, second.output_bytes)
        self.assertEqual(first.usage.as_dict(), second.usage.as_dict())
        self.assertEqual(json.loads(first.output_bytes), first.output_table)

    def test_verifier_passes_gold_cases_and_rejects_wrong_program(self):
        report = verify_gold_cases(self.spec, DEVELOPMENT_GOLD_CASES)
        self.assertTrue(report.passed)
        self.assertFalse(report.complete_benchmark)
        self.assertEqual(len(report.cases), 2)
        wrong = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        wrong["constants"]["threshold"] = 99
        wrong_report = verify_gold_cases(parse_spec(json.dumps(wrong)), DEVELOPMENT_GOLD_CASES)
        self.assertFalse(wrong_report.passed)
        self.assertTrue(any(not case.passed for case in wrong_report.cases))

    def test_empty_and_filter_to_empty_tables_cannot_hide_bad_field_refs(self):
        missing = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        missing["operations"][0]["left"]["name"] = "missing_score"
        empty_table = DEVELOPMENT_GOLD_CASES[1].input_table
        result = execute(parse_spec(json.dumps(missing)), empty_table)
        self.assertEqual(result.status, "failure")
        self.assertEqual(result.error["code"], "missing_field")

        filtered = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        filtered["operations"][2]["left"]["name"] = "missing_after_filter"
        result = execute(parse_spec(json.dumps(filtered)), empty_table)
        self.assertEqual(result.status, "failure")
        self.assertEqual(result.error["code"], "missing_field")

    def test_byte_caps_and_nesting_caps_precede_json_loading(self):
        oversized_invalid = b"{" + b"x" * 1000
        with self.assertRaises(ResourceLimitError) as raised:
            parse_spec(oversized_invalid, limits=ResourceLimits(max_spec_bytes=16))
        self.assertEqual(raised.exception.resource, "spec_bytes")

        deep = "1"
        for _ in range(40):
            deep = "[" + deep + "]"
        with self.assertRaises(ResourceLimitError) as raised:
            parse_spec(
                '{"schema":"vevo.v03.tool-synthesis.spec.v1","version":1,"name":"x","constants":{},"operations":[],"extra":'
                + deep
                + "}",
                limits=ResourceLimits(max_nesting_depth=8),
            )
        self.assertEqual(raised.exception.resource, "nesting_depth")

        result = execute(
            self.spec,
            oversized_invalid,
            ResourceLimits(max_input_bytes=16),
        )
        self.assertEqual(result.status, "failure")
        self.assertEqual(result.error["context"]["resource"], "input_bytes")

    def test_actual_ast_and_projection_work_are_charged(self):
        result = execute(self.spec, DEVELOPMENT_GOLD_CASES[0].input_table)
        self.assertGreater(result.usage.ast_nodes, 0)
        self.assertGreaterEqual(result.usage.steps, len(DEVELOPMENT_GOLD_CASES[0].expected_output["rows"]))

    def test_filters_after_projects_are_rejected_by_static_order_contract(self):
        invalid = json.loads(DEVELOPMENT_SPEC_DOCUMENT)
        invalid["operations"] = [
            invalid["operations"][1],
            invalid["operations"][0],
            invalid["operations"][3],
        ]
        with self.assertRaises(SpecParseError):
            parse_spec(json.dumps(invalid))

    def test_empty_gold_set_is_inconclusive(self):
        report = verify_gold_cases(self.spec, ())
        self.assertEqual(report.status, "inconclusive")
        self.assertFalse(report.passed)

    def test_verifier_requires_execution_bytes_to_match_output_table(self):
        normal = execute(self.spec, DEVELOPMENT_GOLD_CASES[0].input_table)
        tampered = ExecutionResult(normal.status, normal.output_table, b"{}", normal.usage, normal.error)
        with patch("vevo_agents.v03_tool_synthesis_verifier.execute", return_value=tampered):
            report = verify_gold_cases(self.spec, (DEVELOPMENT_GOLD_CASES[0],))
        self.assertFalse(report.passed)
        self.assertFalse(report.cases[0].passed)
        self.assertFalse(report.cases[0].error["output_bytes_consistent"])

    def test_specialist_unavailable_state_never_fabricates_output(self):
        capability = SpecialistCapability(
            name="symbolic-review",
            description="future local symbolic review capability",
            input_schema="vevo.input.v1",
            output_schema="vevo.output.v1",
            max_input_bytes=1024,
            max_output_bytes=2048,
            max_latency_ms=20,
            resident_weight_bytes=100,
            resident_ram_bytes=200,
            cost_units=3,
            execution_kind="local_generated_tool",
        )
        registry = LocalSpecialistRegistry()
        registry.register_capability(capability)
        result = registry.request(
            SpecialistRequest(
                request_id="request-1",
                capability=capability,
                input_payload={"value": 1},
                budget=SystemResourceBudget(1000, 1000, 1000, 1000),
            )
        )
        self.assertEqual(result.status, "unavailable_provider")
        self.assertIsNone(result.provider)
        self.assertIsNone(result.output_payload)
        self.assertEqual(result.error["code"], "unavailable_provider")
        self.assertEqual(result.verification["status"], "not_run")
        self.assertEqual(result.memory_feedback["status"], "unavailable_provider")
        self.assertEqual(capability.as_dict()["execution_kind"], "local_generated_tool")

    def test_total_system_budget_includes_controller_and_specialist(self):
        budget = SystemResourceBudget(100, 100, 10, 10)
        report = check_system_budget(
            ResourceEstimate(60, 40, 5, 4),
            (ResourceEstimate(50, 30, 6, 5),),
            budget,
        )
        self.assertFalse(report.allowed)
        self.assertEqual(report.totals.weight_bytes, 110)
        self.assertEqual(report.rejected_dimensions, ("weight_bytes", "latency_ms"))


if __name__ == "__main__":
    unittest.main()
