import unittest
import types
from unittest import mock

import telemetry_server


def stage_result(delta_v):
    return {
        "stage.available": True,
        "stage.complete": True,
        "stage.count": 1,
        "stage.currentKsp": 0,
        "stage.stages": [{
            "index": 0,
            "ksp": 0,
            "dvAtmo": delta_v,
            "dvVac": delta_v + 100,
            "twrAtmo": 1.2,
            "twrVac": 1.3,
            "burn": 42.0,
        }],
        "stage.totalDvAtmo": delta_v,
        "stage.totalDvVac": delta_v + 100,
    }


class EditorService:
    available = True
    editor_revision = 1
    editor_stable = True
    editor_craft_name = "Prototype"
    editor_body = "Kerbin"
    editor_altitude = 0
    editor_mach = 0
    game_save_folder = "Prototype Save"
    editor_craft_persistent_id = "craft-1"
    editor_root_part_persistent_id = "part-1"
    editor_part_count = 10
    editor_crew_capacity = 2
    editor_stage_count = 1
    editor_wet_mass = 12.0
    editor_dry_mass = 5.0
    editor_resource_mass = 7.0
    editor_total_cost = 25_000
    editor_dry_cost = 20_000
    editor_resource_cost = 5_000
    editor_rebuild_diagnostics_schema = 1
    editor_craft_revision = 1
    editor_stage_sequence_revision = 0
    editor_part_set_rebuild_revision = -1
    editor_part_set_rebuild_supported = False
    editor_part_set_rebuild_error = "not_checked"
    editor_last_change = "craft"
    editor_staging_fingerprint = "topology-1"
    editor_stage_part_counts_value = [10]

    def editor_body_names(self):
        return ["Kerbin", "Mun"]

    def editor_resource_names(self):
        return ["LiquidFuel"]

    def editor_resource_amounts(self):
        return [100.0]

    def editor_resource_capacities(self):
        return [200.0]

    def editor_stage_part_counts(self):
        return self.editor_stage_part_counts_value


class EditorConnection:
    def __init__(self, service):
        self.stage_stats = service


class LegacyEditorService(EditorService):
    @property
    def editor_rebuild_diagnostics_schema(self):
        raise AttributeError("StageStats 0.2.5 has no rebuild diagnostics")


class FailingDiagnosticsEditorService(EditorService):
    @property
    def editor_rebuild_diagnostics_schema(self):
        raise RuntimeError("transient RPC failure")


class CompletionAwareEditorService(EditorService):
    editor_rebuild_diagnostics_schema = 2
    editor_simulation_tracking_supported = True
    editor_simulation_tracking_error = ""
    editor_simulation_started_revision = 1
    editor_simulation_revision = 1


def completed_stage_result(revision=1, simulation_revision=None):
    result = stage_result(1_000.0)
    result.update({
        "stage.snapshotSchema": 2,
        "stage.snapshotEditorRevision": revision,
        "stage.snapshotCraftRevision": 1,
        "stage.snapshotStageSequenceRevision": 0,
        "stage.snapshotPartSetRebuildRevision": -1,
        "stage.snapshotSimulationRevision": (
            revision
            if simulation_revision is None
            else simulation_revision
        ),
        "stage.snapshotStable": True,
    })
    return result


class MissingServiceConnection:
    @property
    def stage_stats(self):
        raise RuntimeError("StageStats service disappeared")


class EditorAnalysisRetentionTests(unittest.TestCase):
    def setUp(self):
        telemetry_server._editor_bodies_cache = []
        telemetry_server._reset_editor_stage_state()
        self.service = EditorService()
        self.conn = EditorConnection(self.service)
        self.polling = mock.patch.object(telemetry_server, "STAGE_POLL_SECONDS", 0)
        self.polling.start()

    def tearDown(self):
        self.polling.stop()
        telemetry_server._editor_bodies_cache = []
        telemetry_server._reset_editor_stage_state()

    def gather(self, result):
        with mock.patch.object(
            telemetry_server, "_gather_stages", return_value=result
        ):
            return telemetry_server._gather_editor_telemetry(self.conn, "VAB")

    def publish_initial(self):
        result = stage_result(1_000.0)
        first = self.gather(result)
        second = self.gather(result)
        self.assertTrue(first["stage.pending"])
        self.assertFalse(second["stage.pending"])
        return second

    def test_first_analysis_publishes_summary_and_stages_atomically(self):
        result = stage_result(1_000.0)

        first = self.gather(result)
        second = self.gather(result)

        self.assertTrue(first["stage.pending"])
        self.assertNotIn("stage.stages", first)
        self.assertNotIn("editor.wetMass", first)
        self.assertNotIn("editor.analysisRevision", first)
        self.assertFalse(second["stage.pending"])
        self.assertEqual(second["editor.analysisRevision"], 1)
        self.assertEqual(second["editor.wetMass"], 12.0)
        self.assertEqual(second["stage.totalDvAtmo"], 1_000.0)

    def test_stagestats_025_without_diagnostics_remains_compatible(self):
        self.service = LegacyEditorService()
        self.conn = EditorConnection(self.service)

        first = self.gather(stage_result(1_000.0))
        second = self.gather(stage_result(1_000.0))

        self.assertTrue(first["stage.pending"])
        self.assertFalse(second["stage.pending"])
        self.assertEqual(second["editor.analysisRevision"], 1)
        self.assertNotIn("editor.rebuildDiagnosticsSchema", second)

    def test_completed_schema_two_generation_publishes_first_sample(self):
        self.service = CompletionAwareEditorService()
        self.conn = EditorConnection(self.service)
        result = completed_stage_result()

        with mock.patch.object(
            telemetry_server, "_gather_stages", return_value=result
        ) as gather_stages:
            payload = telemetry_server._gather_editor_telemetry(
                self.conn, "VAB"
            )

        self.assertFalse(payload["stage.pending"])
        self.assertEqual(payload["editor.analysisRevision"], 1)
        self.assertEqual(payload["editor.simulationRevision"], 1)
        self.assertTrue(
            gather_stages.call_args.kwargs[
                "atomic_editor_completion_proven"
            ]
        )

    def test_schema_two_without_completion_uses_two_sample_fallback(self):
        self.service = CompletionAwareEditorService()
        self.service.editor_simulation_revision = 0
        self.conn = EditorConnection(self.service)
        result = completed_stage_result(simulation_revision=0)

        first = self.gather(result)
        second = self.gather(result)

        self.assertTrue(first["stage.pending"])
        self.assertFalse(second["stage.pending"])
        self.assertEqual(second["editor.analysisRevision"], 1)

    def test_diagnostics_transport_failure_cannot_use_legacy_path(self):
        self.service = FailingDiagnosticsEditorService()
        self.conn = EditorConnection(self.service)

        first = self.gather(stage_result(1_000.0))
        second = self.gather(stage_result(1_000.0))

        self.assertTrue(first["stage.pending"])
        self.assertTrue(second["stage.pending"])
        self.assertNotIn("editor.analysisRevision", second)
        self.assertEqual(
            second["editor.partSetRebuildError"],
            "diagnostics_schema_RuntimeError",
        )

    def test_confirmation_samples_remain_half_second_apart(self):
        result = stage_result(1_000.0)
        with (
            mock.patch.object(telemetry_server, "STAGE_POLL_SECONDS", 0.5),
            mock.patch.object(
                telemetry_server.time,
                "time",
                side_effect=[100.0, 100.49, 100.5],
            ),
        ):
            first = self.gather(result)
            early = self.gather(result)
            confirmed = self.gather(result)

        self.assertTrue(first["stage.pending"])
        self.assertTrue(early["stage.pending"])
        self.assertFalse(confirmed["stage.pending"])
        self.assertEqual(confirmed["editor.analysisRevision"], 1)

    def test_same_craft_revision_retains_published_bundle_while_unstable(self):
        published = self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_stable = False

        pending = self.gather(stage_result(2_000.0))

        self.assertTrue(pending["stage.pending"])
        self.assertEqual(pending["editor.revision"], 2)
        self.assertEqual(pending["editor.analysisRevision"], 1)
        self.assertEqual(
            pending["stage.totalDvAtmo"], published["stage.totalDvAtmo"]
        )
        self.assertEqual(pending["editor.wetMass"], published["editor.wetMass"])

    def test_new_revision_replaces_whole_bundle_only_after_confirmation(self):
        self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_wet_mass = 15.0
        changed = stage_result(1_500.0)

        first = self.gather(changed)
        second = self.gather(changed)

        self.assertTrue(first["stage.pending"])
        self.assertEqual(first["editor.analysisRevision"], 1)
        self.assertEqual(first["editor.wetMass"], 12.0)
        self.assertEqual(first["stage.totalDvAtmo"], 1_000.0)
        self.assertFalse(second["stage.pending"])
        self.assertEqual(second["editor.analysisRevision"], 2)
        self.assertEqual(second["editor.wetMass"], 15.0)
        self.assertEqual(second["stage.totalDvAtmo"], 1_500.0)

    def test_condition_only_revision_reuses_confirmed_craft_summary(self):
        self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_last_change = "conditions"

        with mock.patch.object(
            telemetry_server, "_gather_editor_summary"
        ) as gather_summary:
            first = self.gather(stage_result(1_500.0))
            second = self.gather(stage_result(1_500.0))

        gather_summary.assert_not_called()
        self.assertTrue(first["stage.pending"])
        self.assertFalse(second["stage.pending"])
        self.assertEqual(second["editor.analysisRevision"], 2)
        self.assertEqual(second["editor.wetMass"], 12.0)
        self.assertEqual(second["stage.totalDvAtmo"], 1_500.0)

    def test_condition_label_cannot_mask_intervening_craft_change(self):
        self.publish_initial()
        self.service.editor_revision = 3
        self.service.editor_craft_revision = 2
        self.service.editor_last_change = "conditions"
        self.service.editor_wet_mass = 15.0
        original = telemetry_server._gather_editor_summary

        with mock.patch.object(
            telemetry_server,
            "_gather_editor_summary",
            side_effect=original,
        ) as gather_summary:
            first = self.gather(stage_result(1_500.0))
            second = self.gather(stage_result(1_500.0))

        self.assertEqual(gather_summary.call_count, 1)
        self.assertTrue(first["stage.pending"])
        self.assertFalse(second["stage.pending"])
        self.assertEqual(second["editor.wetMass"], 15.0)
        self.assertEqual(
            telemetry_server._editor_analysis_craft_revision, 2
        )

    def test_atomic_snapshot_craft_generation_must_match_diagnostics(self):
        result = stage_result(1_500.0)
        result.update({
            "stage.snapshotSchema": 1,
            "stage.snapshotEditorRevision": 1,
            "stage.snapshotCraftRevision": 99,
            "stage.snapshotStageSequenceRevision": 0,
            "stage.snapshotPartSetRebuildRevision": -1,
            "stage.snapshotStable": True,
        })

        payload = self.gather(result)

        self.assertTrue(payload["stage.pending"])
        self.assertNotIn("editor.analysisRevision", payload)

    def test_transient_summary_failure_cannot_replace_atomic_bundle(self):
        self.publish_initial()
        self.service.editor_revision = 2
        with mock.patch.object(
            telemetry_server,
            "_gather_editor_summary",
            return_value={"editor.summaryAvailable": False},
        ):
            first = self.gather(stage_result(1_500.0))
            second = self.gather(stage_result(1_500.0))

        self.assertTrue(first["stage.pending"])
        self.assertTrue(second["stage.pending"])
        self.assertEqual(second["editor.analysisRevision"], 1)
        self.assertEqual(second["editor.wetMass"], 12.0)
        self.assertEqual(second["stage.totalDvAtmo"], 1_000.0)

    def test_staging_revision_waits_for_matching_rebuild_schedule(self):
        self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_stage_sequence_revision = 1
        self.service.editor_part_set_rebuild_revision = 0
        self.service.editor_part_set_rebuild_supported = True
        self.service.editor_part_set_rebuild_error = ""
        self.service.editor_last_change = "staging"
        self.service.editor_staging_fingerprint = "topology-2"

        first = self.gather(stage_result(1_500.0))
        second = self.gather(stage_result(1_500.0))

        self.assertTrue(first["stage.pending"])
        self.assertTrue(second["stage.pending"])
        self.assertEqual(second["editor.analysisRevision"], 1)
        self.assertEqual(second["stage.totalDvAtmo"], 1_000.0)
        self.assertEqual(second["editor.stageSequenceRevision"], 1)
        self.assertEqual(second["editor.partSetRebuildRevision"], 0)

    def test_matching_rebuild_schedule_allows_two_sample_promotion(self):
        self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_stage_sequence_revision = 1
        self.service.editor_part_set_rebuild_revision = 1
        self.service.editor_part_set_rebuild_supported = True
        self.service.editor_part_set_rebuild_error = ""
        self.service.editor_last_change = "staging"
        self.service.editor_staging_fingerprint = "topology-2"

        first = self.gather(stage_result(1_500.0))
        second = self.gather(stage_result(1_500.0))

        self.assertTrue(first["stage.pending"])
        self.assertFalse(second["stage.pending"])
        self.assertEqual(second["editor.analysisRevision"], 2)
        self.assertEqual(second["stage.totalDvAtmo"], 1_500.0)
        self.assertEqual(second["editor.partSetRebuildRevision"], 1)

    def test_unsupported_rebuild_contract_retains_previous_analysis(self):
        self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_stage_sequence_revision = 1
        self.service.editor_part_set_rebuild_revision = -1
        self.service.editor_part_set_rebuild_supported = False
        self.service.editor_part_set_rebuild_error = (
            "missing_or_incompatible_fields"
        )

        payload = self.gather(stage_result(1_500.0))

        self.assertTrue(payload["stage.pending"])
        self.assertEqual(payload["editor.revision"], 2)
        self.assertEqual(payload["editor.analysisRevision"], 1)
        self.assertEqual(payload["stage.totalDvAtmo"], 1_000.0)
        self.assertFalse(payload["editor.partSetRebuildSupported"])

    def test_rebuild_recovery_restarts_two_sample_confirmation(self):
        self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_stage_sequence_revision = 1
        self.service.editor_part_set_rebuild_revision = -1
        self.service.editor_part_set_rebuild_supported = False
        self.service.editor_part_set_rebuild_error = "module_unavailable"
        changed = stage_result(1_500.0)

        blocked = self.gather(changed)
        self.service.editor_part_set_rebuild_revision = 1
        self.service.editor_part_set_rebuild_supported = True
        self.service.editor_part_set_rebuild_error = ""
        first_ready = self.gather(changed)
        confirmed = self.gather(changed)

        self.assertTrue(blocked["stage.pending"])
        self.assertTrue(first_ready["stage.pending"])
        self.assertEqual(first_ready["editor.analysisRevision"], 1)
        self.assertFalse(confirmed["stage.pending"])
        self.assertEqual(confirmed["editor.analysisRevision"], 2)

    def test_topology_change_during_confirmation_cannot_publish(self):
        self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_stage_sequence_revision = 1
        self.service.editor_part_set_rebuild_revision = 1
        self.service.editor_part_set_rebuild_supported = True
        self.service.editor_part_set_rebuild_error = ""
        self.service.editor_staging_fingerprint = "topology-2"
        changed = stage_result(1_500.0)
        self.gather(changed)

        def change_topology(*_args, **_kwargs):
            self.service.editor_staging_fingerprint = "topology-3"
            return changed

        with mock.patch.object(
            telemetry_server, "_gather_stages", side_effect=change_topology
        ):
            payload = telemetry_server._gather_editor_telemetry(
                self.conn, "VAB"
            )

        self.assertTrue(payload["stage.pending"])
        self.assertEqual(payload["editor.analysisRevision"], 1)
        self.assertEqual(payload["stage.totalDvAtmo"], 1_000.0)
        self.assertEqual(
            payload["editor.stagingFingerprint"], "topology-3"
        )

    def test_changed_signature_does_not_promote(self):
        self.publish_initial()
        self.service.editor_revision = 2

        first = self.gather(stage_result(1_500.0))
        second = self.gather(stage_result(1_600.0))

        self.assertTrue(first["stage.pending"])
        self.assertTrue(second["stage.pending"])
        self.assertEqual(second["editor.analysisRevision"], 1)
        self.assertEqual(second["stage.totalDvAtmo"], 1_000.0)

    def test_revision_change_during_second_sample_cannot_publish_fresh(self):
        self.publish_initial()
        self.service.editor_revision = 2
        changed = stage_result(1_500.0)
        self.gather(changed)

        def change_revision(*_args, **_kwargs):
            self.service.editor_revision = 3
            self.service.editor_stable = False
            return changed

        with mock.patch.object(
            telemetry_server, "_gather_stages", side_effect=change_revision
        ):
            payload = telemetry_server._gather_editor_telemetry(self.conn, "VAB")

        self.assertTrue(payload["stage.pending"])
        self.assertEqual(payload["editor.revision"], 3)
        self.assertEqual(payload["editor.analysisRevision"], 1)
        self.assertEqual(payload["stage.totalDvAtmo"], 1_000.0)

    def test_identity_change_hard_clears_retained_bundle(self):
        self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_stable = False
        self.service.editor_craft_persistent_id = "craft-2"

        changed = self.gather(stage_result(2_000.0))

        self.assertTrue(changed["stage.pending"])
        self.assertNotIn("editor.analysisRevision", changed)
        self.assertNotIn("stage.stages", changed)
        self.assertNotIn("editor.wetMass", changed)

    def test_missing_identity_fails_closed(self):
        self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_stable = False
        self.service.editor_root_part_persistent_id = ""

        missing = self.gather(stage_result(2_000.0))

        self.assertNotIn("editor.analysisRevision", missing)
        self.assertNotIn("stage.stages", missing)

    def test_core_loss_hard_clears_retained_bundle(self):
        self.publish_initial()
        self.service.editor_revision = 2
        self.service.editor_stable = False
        self.service.available = False

        payload = self.gather(stage_result(2_000.0))

        self.assertFalse(payload["stage.available"])
        self.assertFalse(payload["stage.pending"])
        self.assertNotIn("editor.analysisRevision", payload)
        self.assertNotIn("stage.stages", payload)
        self.assertNotIn("editor.wetMass", payload)

    def test_core_loss_during_second_sample_cannot_publish_or_retain(self):
        self.publish_initial()
        self.service.editor_revision = 2
        changed = stage_result(1_500.0)
        self.gather(changed)

        def lose_core(*_args, **_kwargs):
            self.service.available = False
            return changed

        with mock.patch.object(
            telemetry_server, "_gather_stages", side_effect=lose_core
        ):
            payload = telemetry_server._gather_editor_telemetry(self.conn, "VAB")

        self.assertFalse(payload["stage.available"])
        self.assertFalse(payload["stage.pending"])
        self.assertNotIn("editor.analysisRevision", payload)
        self.assertNotIn("stage.stages", payload)

    def test_service_lookup_failure_hard_clears_retained_bundle(self):
        self.publish_initial()

        payload = telemetry_server._gather_editor_telemetry(
            MissingServiceConnection(), "VAB"
        )

        self.assertFalse(payload["stage.available"])
        self.assertFalse(payload["stage.pending"])
        self.assertNotIn("editor.analysisRevision", payload)
        self.assertEqual(telemetry_server._editor_stage_cache, {})
        self.assertEqual(telemetry_server._editor_summary_cache, {})

    def test_scene_hard_reset_drops_all_published_provenance(self):
        self.publish_initial()

        telemetry_server._reset_editor_stage_state()

        self.assertIsNone(telemetry_server._editor_analysis_revision)
        self.assertEqual(telemetry_server._editor_stage_cache, {})
        self.assertEqual(telemetry_server._editor_summary_cache, {})


class EditorConditionCommandTests(unittest.TestCase):
    def editor_connection(self, service):
        game_scene = types.SimpleNamespace(
            editor_vab="editor_vab",
            editor_sph="editor_sph",
        )
        return types.SimpleNamespace(
            stage_stats=service,
            krpc=types.SimpleNamespace(
                current_game_scene="editor_vab",
                GameScene=game_scene,
            ),
        )

    def test_atomic_condition_command_uses_one_service_call(self):
        service = EditorService()
        service.set_editor_conditions = mock.Mock()

        telemetry_server._apply_telemetry_command(
            self.editor_connection(service),
            {
                "type": "editor.conditions",
                "body": "Mun",
                "altitude": 1200,
                "mach": 0.35,
            },
        )

        service.set_editor_conditions.assert_called_once_with(
            "Mun", 1200.0, 0.35
        )

    def test_missing_atomic_api_uses_legacy_property_fallback(self):
        class LegacyConditionsService(EditorService):
            def set_editor_conditions(self, *_args):
                raise AttributeError("StageStats 0.2.5")

        service = LegacyConditionsService()
        telemetry_server._apply_telemetry_command(
            self.editor_connection(service),
            {
                "type": "editor.conditions",
                "body": "Mun",
                "altitude": 1200,
                "mach": 0.35,
            },
        )

        self.assertEqual(service.editor_body, "Mun")
        self.assertEqual(service.editor_altitude, 1200.0)
        self.assertEqual(service.editor_mach, 0.35)


if __name__ == "__main__":
    unittest.main()
