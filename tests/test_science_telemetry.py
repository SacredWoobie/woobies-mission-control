import unittest
from types import SimpleNamespace

import telemetry_server


class LabService:
    available = True

    def titles(self):
        return ["Mystery Goo"]

    def science_values(self):
        return [12.0]

    def transmit_values(self):
        return [7.0]

    def data_amounts(self):
        return [4.0]

    def lab_count(self):
        return 1

    def failed_lab_count(self):
        return 0

    def lab_day_seconds(self):
        return 21_600

    def lab_ids(self):
        return ["42:1"]

    def lab_part_titles(self):
        return ["PX-L2 'Fate' Deep-Space Laboratory Module"]

    def lab_data_stored(self):
        return [1455.199]

    def lab_data_capacities(self):
        return [1500.0]

    def lab_science_stored(self):
        return [2.484]

    def lab_science_capacities(self):
        return [500.0]

    def lab_calculated_science_rates(self):
        return [53.042]

    def lab_science_multipliers(self):
        return [5.0]

    def lab_crew_counts(self):
        return [3]

    def lab_scientist_counts(self):
        return [3]

    def lab_crew_required(self):
        return [1.0]

    def lab_scientist_factors(self):
        return [6.75]

    def lab_converters_available(self):
        return [True]

    def lab_research_enabled(self):
        return [True]

    def lab_operational(self):
        return [True]

    def lab_converter_statuses(self):
        return ["Researching"]

    def lab_last_time_factors(self):
        return [1.0]


class AlarmManager:
    def __init__(self):
        self.created = []

    def add_vessel_alarm(self, delay, vessel, title, description):
        self.created.append((delay, vessel, title, description))
        return SimpleNamespace(id=17)


class KacService:
    AlarmType = SimpleNamespace(raw="raw")
    AlarmAction = SimpleNamespace(message_only="message_only")

    def __init__(self, available=True):
        self.available = available
        self.created = []

    def create_alarm(self, alarm_type, title, trigger_ut):
        alarm = SimpleNamespace(vessel=None, notes="", action=None)
        self.created.append((alarm_type, title, trigger_ut, alarm))
        return alarm


def alarm_connection(kac_available=True):
    vessel = SimpleNamespace(name="Odyssey")
    manager = AlarmManager()
    kac = KacService(kac_available)
    return SimpleNamespace(
        vessel_science=LabService(),
        kerbal_alarm_clock=kac,
        space_center=SimpleNamespace(
            active_vessel=vessel,
            alarm_manager=manager,
            ut=9_493_824.0,
        ),
    ), vessel, manager, kac


class ScienceTelemetryTests(unittest.TestCase):
    def test_emits_decay_aware_lab_eta_for_reference_craft(self):
        result = telemetry_server._gather_science(
            SimpleNamespace(vessel_science=LabService()),
            SimpleNamespace(),
        )

        self.assertTrue(result["sci.krpc.labTelemetryAvailable"])
        lab = result["sci.krpc.labs"][0]
        self.assertEqual(lab["id"], "42:1")
        self.assertEqual(lab["state"], "researching")
        self.assertEqual(lab["sciencePerDay"], 53.042)
        self.assertEqual(lab["etaKind"], "finite")
        self.assertAlmostEqual(lab["etaSeconds"], 209_860.3, delta=1.0)

    def test_reports_full_lab_as_blocked_without_draining_data(self):
        service = LabService()
        service.lab_science_stored = lambda: [500.0]
        result = telemetry_server._gather_science_labs(service)

        lab = result["sci.krpc.labs"][0]
        self.assertEqual(lab["state"], "science-full")
        self.assertEqual(lab["sciencePerDay"], 0.0)
        self.assertEqual(lab["etaKind"], "full")
        self.assertEqual(lab["etaSeconds"], 0.0)

    def test_reports_insufficient_data_instead_of_inventing_an_eta(self):
        service = LabService()
        service.lab_data_stored = lambda: [40.0]
        result = telemetry_server._gather_science_labs(service)

        lab = result["sci.krpc.labs"][0]
        self.assertEqual(lab["state"], "researching")
        self.assertEqual(lab["etaKind"], "insufficient-data")
        self.assertNotIn("etaSeconds", lab)

    def test_preserves_stored_science_with_an_older_service(self):
        service = LabService()
        service.lab_count = None
        result = telemetry_server._gather_science(
            SimpleNamespace(vessel_science=service),
            SimpleNamespace(),
        )

        self.assertEqual(result["sci.krpc.total"], 12.0)
        self.assertNotIn("sci.krpc.labTelemetryAvailable", result)
        self.assertNotIn("sci.krpc.labs", result)

    def test_fails_aligned_lab_rows_closed_when_a_column_is_short(self):
        service = LabService()
        service.lab_ids = lambda: []
        result = telemetry_server._gather_science_labs(service)

        self.assertEqual(result["sci.krpc.labs"], [])
        self.assertEqual(result["sci.krpc.malformedLabCount"], 1)

    def test_creates_kac_alarm_from_a_fresh_eta_with_manual_lead(self):
        conn, vessel, manager, kac = alarm_connection()
        result = telemetry_server._apply_science_alarm_command(conn, {
            "type": "science.alarm.create",
            "requestId": "alarm-1",
            "labId": "42:1",
            "provider": "auto",
            "leadSeconds": 3600,
        })

        self.assertEqual(result["status"], "accepted")
        self.assertEqual(result["provider"], "kac")
        self.assertAlmostEqual(result["triggerUT"], 9_700_084.3, delta=1.0)
        self.assertEqual(len(manager.created), 0)
        alarm_type, title, trigger_ut, alarm = kac.created[0]
        self.assertEqual(alarm_type, "raw")
        self.assertIn("Odyssey science lab", title)
        self.assertAlmostEqual(trigger_ut, result["triggerUT"], delta=0.1)
        self.assertIs(alarm.vessel, vessel)
        self.assertIn("60-minute lead", alarm.notes)
        self.assertEqual(alarm.action, "message_only")

    def test_falls_back_to_stock_vessel_alarm_when_kac_is_unavailable(self):
        conn, vessel, manager, kac = alarm_connection(kac_available=False)
        result = telemetry_server._apply_science_alarm_command(conn, {
            "type": "science.alarm.create",
            "requestId": "alarm-2",
            "labId": "42:1",
            "provider": "auto",
            "leadSeconds": 1800,
        })

        self.assertEqual(result["provider"], "stock")
        self.assertEqual(len(kac.created), 0)
        delay, linked_vessel, title, description = manager.created[0]
        self.assertAlmostEqual(delay, 208_060.3, delta=1.0)
        self.assertIs(linked_vessel, vessel)
        self.assertIn("science lab", title)
        self.assertIn("30-minute lead", description)

    def test_rejects_a_stale_lab_without_creating_an_alarm(self):
        conn, _vessel, manager, kac = alarm_connection()
        result = telemetry_server._apply_science_alarm_command(conn, {
            "type": "science.alarm.create",
            "requestId": "alarm-3",
            "labId": "missing",
            "provider": "auto",
            "leadSeconds": 3600,
        })

        self.assertEqual(result["status"], "error")
        self.assertEqual(manager.created, [])
        self.assertEqual(kac.created, [])


if __name__ == "__main__":
    unittest.main()
