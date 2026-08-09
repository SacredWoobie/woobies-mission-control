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


if __name__ == "__main__":
    unittest.main()
