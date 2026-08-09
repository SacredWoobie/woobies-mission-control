import unittest
from types import SimpleNamespace

from damage import gather_part_damage


class FakeState:
    def __init__(self, name):
        self.name = name


def component(title, *, state="extended", broken=False, tag=""):
    return SimpleNamespace(
        state=FakeState(state),
        broken=broken,
        part=SimpleNamespace(title=title, name=title.lower(), tag=tag),
    )


class FakeParts:
    solar_panels = []
    radiators = []
    antennas = []
    legs = []
    wheels = []
    reaction_wheels = []

    def __init__(self, **collections):
        for name in (
            "solar_panels", "radiators", "antennas", "legs", "wheels",
            "reaction_wheels",
        ):
            setattr(self, name, list(collections.get(name, [])))


class DamageTelemetryTests(unittest.TestCase):
    def gather(self, parts, **options):
        return gather_part_damage(SimpleNamespace(parts=parts), **options)

    def test_reports_all_stock_breakable_families_and_groups_duplicates(self):
        result = self.gather(FakeParts(
            solar_panels=[
                component("OX-4L 1x6 Photovoltaic Panels", state="broken"),
                component("OX-4L 1x6 Photovoltaic Panels", state="broken"),
            ],
            radiators=[component("Thermal Control System", state="broken", tag="Port")],
            antennas=[component("Communotron 88-88", state="broken")],
            legs=[component("LT-2 Landing Strut", state="broken")],
            wheels=[component("RoveMax Model M1", state="broken")],
            reaction_wheels=[component("Advanced Reaction Wheel Module", broken=True)],
        ))

        self.assertEqual(result["damage.status"], "known")
        self.assertEqual(result["damage.checkedCount"], 7)
        self.assertEqual(result["damage.damagedCount"], 7)
        self.assertEqual(result["damage.incompleteKinds"], [])
        self.assertEqual(
            {(row["kind"], row["name"], row["tag"], row["count"])
             for row in result["damage.parts"]},
            {
                ("solar_panel", "OX-4L 1x6 Photovoltaic Panels", "", 2),
                ("radiator", "Thermal Control System", "Port", 1),
                ("antenna", "Communotron 88-88", "", 1),
                ("landing_leg", "LT-2 Landing Strut", "", 1),
                ("wheel", "RoveMax Model M1", "", 1),
                ("reaction_wheel", "Advanced Reaction Wheel Module", "", 1),
            },
        )

    def test_known_empty_does_not_invent_damage(self):
        result = self.gather(FakeParts())
        self.assertEqual(result["damage.status"], "known")
        self.assertEqual(result["damage.parts"], [])
        self.assertEqual(result["damage.damagedCount"], 0)

    def test_remote_tech_antennas_are_explicitly_unsupported(self):
        result = self.gather(
            FakeParts(antennas=[component("Communotron", state="broken")]),
            remote_tech_active=True,
        )
        self.assertEqual(result["damage.status"], "known")
        self.assertEqual(result["damage.parts"], [])
        self.assertNotIn("antenna", result["damage.checkedKinds"])
        self.assertEqual(result["damage.unsupportedKinds"], ["antenna"])

    def test_partial_collection_failure_fails_source_integrity_closed(self):
        class FailingParts(FakeParts):
            @property
            def radiators(self):
                raise RuntimeError("radiator RPC failed")

            @radiators.setter
            def radiators(self, _value):
                pass

        parts = FailingParts(solar_panels=[component("Panel", state="broken")])
        result = self.gather(parts)
        self.assertEqual(result["damage.status"], "incomplete")
        self.assertIn("radiator", result["damage.incompleteKinds"])
        self.assertEqual(result["damage.damagedCount"], 1)

    def test_missing_parts_surface_is_unknown(self):
        result = gather_part_damage(SimpleNamespace())
        self.assertEqual(result["damage.status"], "unknown")
        self.assertEqual(result["damage.parts"], [])

    def test_vessel_damage_service_covers_grouped_modded_deployables(self):
        service = SimpleNamespace(
            available=True,
            checked_part_count=36,
            checked_module_count=36,
            status="known",
            read_error_count=0,
            damaged_count=3,
            part_ids=lambda: [101, 102, 201],
            part_names=lambda: [
                "nfex-antenna-reflector-huge-1",
                "nfex-antenna-reflector-huge-1",
                "radiator-universal-1",
            ],
            part_titles=lambda: [
                "RFL-100 Giant Dish Reflector",
                "RFL-100 Giant Dish Reflector",
                "XR-175 High Temperature Heat Radiator",
            ],
            part_tags=lambda: ["", "", ""],
            module_names=lambda: [
                "ModuleDeployableReflector",
                "ModuleDeployableReflector",
                "ModuleDeployableRadiator",
            ],
            kinds=lambda: ["antenna", "antenna", "radiator"],
            detectors=lambda: [
                "ModuleDeployablePart.deployState",
                "ModuleDeployablePart.deployState",
                "ModuleDeployablePart.deployState",
            ],
            supported_detectors=lambda: [
                "ModuleDeployablePart.deployState",
                "ModuleWheelDamage.isDamaged",
            ],
        )
        result = gather_part_damage(
            SimpleNamespace(),
            connection=SimpleNamespace(vessel_damage=service),
            remote_tech_active=True,
        )

        self.assertEqual(result["damage.status"], "known")
        self.assertEqual(result["damage.source"], "vessel_damage")
        self.assertEqual(result["damage.checkedCount"], 36)
        self.assertEqual(result["damage.checkedModuleCount"], 36)
        self.assertEqual(result["damage.damagedCount"], 3)
        self.assertEqual(result["damage.unsupportedKinds"], [])
        self.assertEqual(
            {(row["kind"], row["name"], row["module"], row["count"])
             for row in result["damage.parts"]},
            {
                ("antenna", "RFL-100 Giant Dish Reflector",
                 "ModuleDeployableReflector", 2),
                ("radiator", "XR-175 High Temperature Heat Radiator",
                 "ModuleDeployableRadiator", 1),
            },
        )

    def test_malformed_service_payload_fails_closed_without_stock_fallback(self):
        service = SimpleNamespace(
            available=True,
            checked_part_count=1,
            checked_module_count=1,
            status="known",
            read_error_count=0,
            damaged_count=1,
            part_ids=lambda: [],
            part_names=lambda: [],
            part_titles=lambda: [],
            part_tags=lambda: [],
            module_names=lambda: [],
            kinds=lambda: [],
            detectors=lambda: [],
            supported_detectors=lambda: [],
        )
        result = gather_part_damage(
            SimpleNamespace(parts=FakeParts(
                radiators=[component("Radiator", state="broken")]
            )),
            connection=SimpleNamespace(vessel_damage=service),
        )

        self.assertEqual(result["damage.status"], "incomplete")
        self.assertEqual(result["damage.source"], "vessel_damage")
        self.assertEqual(result["damage.parts"], [])

    def test_missing_service_keeps_stock_fallback(self):
        class ConnectionWithoutDamage:
            @property
            def vessel_damage(self):
                raise AttributeError("service is not installed")

        result = gather_part_damage(
            SimpleNamespace(parts=FakeParts(
                radiators=[component("Radiator", state="broken")]
            )),
            connection=ConnectionWithoutDamage(),
        )

        self.assertEqual(result["damage.status"], "known")
        self.assertEqual(result["damage.source"], "stock_krpc")
        self.assertEqual(result["damage.damagedCount"], 1)
        self.assertEqual(result["damage.lossStatus"], "unavailable")

    def test_0211_service_reports_mixed_current_damage_and_loss_history(self):
        service = SimpleNamespace(
            available=True,
            checked_part_count=12,
            checked_module_count=8,
            status="known",
            read_error_count=0,
            damaged_count=2,
            part_ids=lambda: [101, 202],
            part_names=lambda: ["radiator", "nfex-antenna-feeder-relay-1"],
            part_titles=lambda: ["Radiator", "F-RA Relay Antenna Feed"],
            part_tags=lambda: ["", "Relay 2"],
            module_names=lambda: ["ModuleDeployableRadiator", "ModuleRTAntenna"],
            kinds=lambda: ["radiator", "antenna"],
            detectors=lambda: ["ModuleDeployablePart.deployState", "joint_break"],
            conditions=lambda: ["damaged", "lost"],
            event_ids=lambda: ["", "loss-202"],
            supported_detectors=lambda: ["ModuleDeployablePart.deployState"],
            loss_status="known",
            loss_event_count=2,
            loss_event_ids=lambda: ["loss-202", "loss-77"],
            loss_part_ids=lambda: [202, 77],
            loss_part_names=lambda: ["nfex-antenna-feeder-relay-1", "winglet"],
            loss_part_titles=lambda: ["F-RA Relay Antenna Feed", "Booster Fin"],
            loss_part_tags=lambda: ["Relay 2", ""],
            loss_module_names=lambda: ["ModuleRTAntenna", "ModuleLiftingSurface"],
            loss_kinds=lambda: ["antenna", "wing"],
            loss_states=lambda: ["active", "cleared"],
            loss_occurrence_uts=lambda: [1000.0, 900.0],
            loss_occurrence_mets=lambda: [120.0, 20.0],
            loss_cleared_uts=lambda: [-1.0, 950.0],
            loss_clear_reasons=lambda: ["", "intentional_separation"],
            loss_causes=lambda: ["joint_break", "destroyed"],
        )
        result = gather_part_damage(
            SimpleNamespace(), connection=SimpleNamespace(vessel_damage=service)
        )

        self.assertEqual(result["damage.lossStatus"], "known")
        self.assertEqual(len(result["damage.lossEvents"]), 2)
        lost = next(row for row in result["damage.parts"]
                    if row["condition"] == "lost")
        self.assertEqual(lost["eventId"], "loss-202")
        self.assertEqual(lost["partId"], 202)
        self.assertEqual(lost["count"], 1)
        cleared = next(row for row in result["damage.lossEvents"]
                       if row["state"] == "cleared")
        self.assertEqual(cleared["clearReason"], "intentional_separation")
        self.assertEqual(cleared["clearedUt"], 950.0)

    def test_0211_misaligned_loss_history_is_incomplete_not_empty_known(self):
        service = SimpleNamespace(
            available=True,
            checked_part_count=0,
            checked_module_count=0,
            status="known",
            read_error_count=0,
            damaged_count=0,
            part_ids=lambda: [],
            part_names=lambda: [],
            part_titles=lambda: [],
            part_tags=lambda: [],
            module_names=lambda: [],
            kinds=lambda: [],
            detectors=lambda: [],
            conditions=lambda: [],
            event_ids=lambda: [],
            supported_detectors=lambda: [],
            loss_status="known",
            loss_event_count=1,
            loss_event_ids=lambda: ["loss"],
            loss_part_ids=lambda: [],
            loss_part_names=lambda: ["part"],
            loss_part_titles=lambda: ["Part"],
            loss_part_tags=lambda: [""],
            loss_module_names=lambda: ["Module"],
            loss_kinds=lambda: ["other"],
            loss_states=lambda: ["active"],
            loss_occurrence_uts=lambda: [1.0],
            loss_occurrence_mets=lambda: [1.0],
            loss_cleared_uts=lambda: [-1.0],
            loss_clear_reasons=lambda: [""],
            loss_causes=lambda: ["topology_change"],
        )
        result = gather_part_damage(
            SimpleNamespace(), connection=SimpleNamespace(vessel_damage=service)
        )
        self.assertEqual(result["damage.status"], "known")
        self.assertEqual(result["damage.lossStatus"], "incomplete")
        self.assertEqual(result["damage.lossEvents"], [])


if __name__ == "__main__":
    unittest.main()
