import importlib.util
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "planner_persistence.py"
SPEC = importlib.util.spec_from_file_location("planner_persistence", MODULE_PATH)
planner_persistence = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(planner_persistence)

PlannerPersistence = planner_persistence.PlannerPersistence


def resonant_library(*plans, pinned=None):
    return {
        "schemaVersion": 4,
        "plans": list(plans),
        "pinnedPlanId": pinned,
    }


def delta_v_library(*plans, assignments=(), legacy_pinned=None):
    return {
        "schemaVersion": 2,
        "plans": list(plans),
        "assignments": list(assignments),
        "legacyPinned": legacy_pinned,
    }


def record(record_id, updated_at, **values):
    return {"id": record_id, "updatedAt": updated_at, **values}


class PlannerPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "mission_planning.json"

    def store(self, **options):
        return PlannerPersistence(self.path, **options)

    def test_default_path_uses_local_app_data(self):
        with mock.patch.dict(
            os.environ,
            {"LOCALAPPDATA": self.temporary.name},
            clear=False,
        ):
            expected = (
                Path(self.temporary.name)
                / "WoobiesMissionControl"
                / "mission_planning.json"
            )
            self.assertEqual(
                planner_persistence.default_persistence_path(),
                expected,
            )

    def test_update_persists_each_section_revision_and_backup(self):
        store = self.store()
        value = resonant_library(
            record("plan-a", "2026-07-29T12:00:00Z", name="Kerbin ring"),
            pinned="plan-a",
        )

        result = store.update("resonant", 0, value)

        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["revision"], 1)
        self.assertEqual(result["value"], value)
        self.assertTrue(self.path.is_file())
        self.assertTrue(Path(str(self.path) + ".bak").is_file())
        reloaded = self.store().get("resonant")
        self.assertEqual(reloaded["revision"], 1)
        self.assertEqual(reloaded["value"], value)
        document = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(document["schemaVersion"], 1)
        self.assertEqual(
            set(document["sections"]),
            {"resonant", "deltaVLibrary", "deltaVDraft"},
        )

    def test_update_rejects_stale_revision_without_writing(self):
        store = self.store()
        initial = resonant_library()
        self.assertEqual(
            store.update("resonant", 0, initial)["status"],
            "updated",
        )
        before = self.path.read_bytes()

        conflict = store.update(
            "resonant",
            0,
            resonant_library(
                record("late", "2026-07-29T13:00:00Z"),
            ),
        )

        self.assertEqual(conflict["status"], "conflict")
        self.assertEqual(conflict["revision"], 1)
        self.assertEqual(conflict["value"], initial)
        self.assertEqual(self.path.read_bytes(), before)

    def test_resonant_merge_uses_newer_records_and_preserves_valid_pin(self):
        store = self.store()
        current = resonant_library(
            record(
                "shared",
                "2026-07-29T12:00:00Z",
                name="Current old",
            ),
            record(
                "current-only",
                "2026-07-29T11:00:00Z",
                name="Current only",
            ),
            pinned="current-only",
        )
        store.update("resonant", 0, current)
        incoming = resonant_library(
            record(
                "shared",
                "2026-07-29T13:00:00Z",
                name="Incoming newer",
            ),
            record(
                "incoming-only",
                "2026-07-29T10:00:00Z",
                name="Incoming only",
            ),
            pinned="incoming-only",
        )

        merged = store.merge("resonant", incoming)

        self.assertEqual(merged["status"], "merged")
        self.assertEqual(merged["revision"], 2)
        plans = {plan["id"]: plan for plan in merged["value"]["plans"]}
        self.assertEqual(
            set(plans),
            {"shared", "current-only", "incoming-only"},
        )
        self.assertEqual(plans["shared"]["name"], "Incoming newer")
        self.assertEqual(merged["value"]["pinnedPlanId"], "current-only")

    def test_resonant_merge_uses_incoming_pin_when_current_pin_is_invalid(self):
        store = self.store()
        current = resonant_library(
            record("plan-a", "2026-07-29T12:00:00Z"),
            pinned="missing",
        )
        store.update("resonant", 0, current)

        merged = store.merge(
            "resonant",
            resonant_library(
                record("plan-b", "2026-07-29T13:00:00Z"),
                pinned="plan-b",
            ),
        )

        self.assertEqual(merged["value"]["pinnedPlanId"], "plan-b")

    def test_delta_v_merge_merges_plans_and_assignments_by_id(self):
        store = self.store()
        current_plan = record(
            "plan-a",
            "2026-07-29T12:00:00Z",
            name="Old plan",
        )
        current_assignment = record(
            "assignment-a",
            "2026-07-29T12:00:00Z",
            planId="plan-a",
            completedLegIds=[],
        )
        store.update(
            "deltaVLibrary",
            0,
            delta_v_library(
                current_plan,
                assignments=(current_assignment,),
                legacy_pinned={"planId": "plan-a", "completedLegIds": []},
            ),
        )
        incoming = delta_v_library(
            record(
                "plan-a",
                "2026-07-29T14:00:00Z",
                name="New plan",
            ),
            record(
                "plan-b",
                "2026-07-29T13:00:00Z",
                name="Second plan",
            ),
            assignments=(
                record(
                    "assignment-a",
                    "2026-07-29T14:00:00Z",
                    planId="plan-a",
                    completedLegIds=["leg-1"],
                ),
                record(
                    "assignment-b",
                    "2026-07-29T13:00:00Z",
                    planId="plan-b",
                    completedLegIds=[],
                ),
                record(
                    "dangling",
                    "2026-07-29T15:00:00Z",
                    planId="missing",
                    completedLegIds=[],
                ),
            ),
        )

        merged = store.merge("deltaVLibrary", incoming)

        plans = {
            plan["id"]: plan for plan in merged["value"]["plans"]
        }
        assignments = {
            assignment["id"]: assignment
            for assignment in merged["value"]["assignments"]
        }
        self.assertEqual(plans["plan-a"]["name"], "New plan")
        self.assertEqual(
            assignments["assignment-a"]["completedLegIds"],
            ["leg-1"],
        )
        self.assertIn("assignment-b", assignments)
        self.assertNotIn("dangling", assignments)
        self.assertEqual(
            merged["value"]["legacyPinned"]["planId"],
            "plan-a",
        )

    def test_draft_merge_is_first_non_null_wins(self):
        store = self.store()
        first = {"schemaVersion": 1, "start": {"bodyName": "Kerbin"}}
        second = {"schemaVersion": 1, "start": {"bodyName": "Duna"}}

        empty = store.merge("deltaVDraft", None)
        imported = store.merge("deltaVDraft", first)
        unchanged = store.merge("deltaVDraft", second)

        self.assertEqual(empty["status"], "unchanged")
        self.assertEqual(empty["revision"], 0)
        self.assertEqual(imported["status"], "merged")
        self.assertEqual(imported["revision"], 1)
        self.assertEqual(unchanged["status"], "unchanged")
        self.assertEqual(unchanged["revision"], 1)
        self.assertEqual(unchanged["value"], first)

    def test_corrupt_primary_recovers_backup(self):
        store = self.store()
        first = resonant_library(
            record("plan-a", "2026-07-29T12:00:00Z"),
        )
        store.update("resonant", 0, first)
        self.path.write_text("{broken", encoding="utf-8")

        recovered = self.store().get("resonant")

        self.assertEqual(recovered["status"], "ok")
        self.assertIn("backup", recovered["message"].lower())
        self.assertEqual(recovered["value"], first)

    def test_corrupt_primary_without_backup_is_not_destroyed_on_load(self):
        corrupt = b"{definitely not json"
        self.path.write_bytes(corrupt)

        store = self.store()
        result = store.get("resonant")

        self.assertEqual(result["revision"], 0)
        self.assertIsNone(result["value"])
        self.assertIn("without overwriting", result["message"])
        self.assertEqual(self.path.read_bytes(), corrupt)

        value = resonant_library()
        self.assertEqual(
            store.update("resonant", 0, value)["status"],
            "updated",
        )
        preserved = list(self.path.parent.glob(
            "mission_planning.json.corrupt*"
        ))
        self.assertEqual(len(preserved), 1)
        self.assertEqual(preserved[0].read_bytes(), corrupt)

    def test_first_update_replaces_an_invalid_backup_with_valid_data(self):
        backup = Path(str(self.path) + ".bak")
        backup.write_bytes(b"{broken backup")
        store = self.store()
        value = resonant_library(
            record("plan-a", "2026-07-29T12:00:00Z"),
        )

        result = store.update("resonant", 0, value)

        self.assertEqual(result["status"], "updated")
        recovered_document = json.loads(backup.read_text(encoding="utf-8"))
        self.assertEqual(
            recovered_document["sections"]["resonant"]["value"],
            value,
        )

    def test_rejects_non_json_values_and_wrong_section_schema(self):
        store = self.store()
        cycle = {"schemaVersion": 1}
        cycle["cycle"] = cycle
        deeply_nested = {}
        cursor = deeply_nested
        for _ in range(planner_persistence.MAX_JSON_DEPTH + 2):
            cursor["next"] = {}
            cursor = cursor["next"]
        deeply_nested["schemaVersion"] = 1

        non_finite = store.update(
            "deltaVDraft",
            0,
            {"schemaVersion": 1, "margin": float("nan")},
        )
        bad_key = store.update(
            "deltaVDraft",
            0,
            {"schemaVersion": 1, 5: "not a JSON object key"},
        )
        wrong_schema = store.update(
            "resonant",
            0,
            {"schemaVersion": 3, "plans": [], "pinnedPlanId": None},
        )
        cyclic = store.update("deltaVDraft", 0, cycle)
        too_deep = store.update("deltaVDraft", 0, deeply_nested)

        self.assertEqual(non_finite["status"], "invalid")
        self.assertEqual(bad_key["status"], "invalid")
        self.assertEqual(wrong_schema["status"], "invalid")
        self.assertEqual(cyclic["status"], "invalid")
        self.assertEqual(too_deep["status"], "invalid")
        self.assertFalse(self.path.exists())

    def test_rejects_value_and_total_document_over_size_limit(self):
        store = self.store(max_payload_bytes=400)
        oversized = {
            "schemaVersion": 1,
            "content": "x" * 500,
        }

        result = store.update("deltaVDraft", 0, oversized)

        self.assertIn(result["status"], {"invalid", "too_large"})
        self.assertEqual(result["revision"], 0)
        self.assertFalse(self.path.exists())

        smaller_store = self.store(max_payload_bytes=420)
        resonant = resonant_library(
            record("plan-a", "2026-07-29T12:00:00Z", data="x" * 80),
        )
        delta = delta_v_library(
            record("plan-b", "2026-07-29T12:00:00Z", data="y" * 80),
        )
        first_result = smaller_store.update("resonant", 0, resonant)
        self.assertEqual(first_result["status"], "updated")
        second_result = smaller_store.update("deltaVLibrary", 0, delta)
        self.assertEqual(second_result["status"], "too_large")
        self.assertEqual(second_result["revision"], 0)

    def test_same_base_revision_allows_only_one_concurrent_update(self):
        store = self.store()
        barrier = threading.Barrier(9)
        results = []
        result_lock = threading.Lock()

        def writer(index):
            barrier.wait()
            result = store.update(
                "deltaVDraft",
                0,
                {"schemaVersion": 1, "writer": index},
            )
            with result_lock:
                results.append(result)

        threads = [
            threading.Thread(target=writer, args=(index,))
            for index in range(8)
        ]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())

        self.assertEqual(
            [result["status"] for result in results].count("updated"),
            1,
        )
        self.assertEqual(
            [result["status"] for result in results].count("conflict"),
            7,
        )
        stored = self.store().get("deltaVDraft")
        self.assertEqual(stored["revision"], 1)
        self.assertIn(stored["value"]["writer"], range(8))
        temporary_files = list(
            self.path.parent.glob(".mission_planning.json.*.tmp")
        )
        self.assertEqual(temporary_files, [])


if __name__ == "__main__":
    unittest.main()
