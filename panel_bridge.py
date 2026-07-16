"""ESP32 control-pad bridge for KSP.

This process owns only the physical panel:
  * ESP32 serial input
  * stage arm/safe and stage firing
  * abort arm/safe and abort firing
  * the stage-lock indicator LED

Dashboard telemetry and the WebSocket server live exclusively in
telemetry_server.py. This module does not import or start any dashboard code.

Requires:  pip install pyserial krpc
"""
import sys
import time

import krpc
import serial
import serial.tools.list_ports


SERIAL_BAUD = 115200
SERIAL_PORT = None  # e.g. "COM5" to force it; None = auto-detect
KRPC_RETRY_SECONDS = 2


def find_esp32_port():
    """Return the most likely ESP32 serial port, or None if none is found."""
    candidates = []
    for port in serial.tools.list_ports.comports():
        description = (port.description or "").upper()
        if any(marker in description for marker in (
            "CP210", "CH340", "USB-SERIAL", "USB SERIAL"
        )):
            candidates.append(port.device)

    if len(candidates) == 1:
        return candidates[0]
    if candidates:
        raise RuntimeError(
            f"Multiple candidate serial ports found: {candidates}. Set "
            "SERIAL_PORT near the top of panel_bridge.py to the control pad's "
            "port before continuing."
        )
    return None


def connect_serial():
    port = SERIAL_PORT or find_esp32_port()
    if not port:
        raise RuntimeError(
            "Could not find the ESP32 serial port. Set SERIAL_PORT explicitly "
            "near the top of panel_bridge.py."
        )

    print(f"Opening ESP32 control pad on {port} at {SERIAL_BAUD} baud...")
    connection = serial.Serial(port, SERIAL_BAUD, timeout=0.25)
    time.sleep(2)  # opening the port normally resets the ESP32
    connection.reset_input_buffer()
    # Clear boot noise, then request fresh rocker states. Firmware never reports
    # held fire buttons in response, so reconnecting cannot stage or abort.
    connection.write(b"STATE?\n")
    return connection


def connect_krpc_forever():
    """Wait for KSP's kRPC server and return a dedicated panel connection."""
    while True:
        try:
            print("Connecting to kRPC (ESP32 Control Pad)...")
            connection = krpc.connect(name="ESP32 Control Pad")
            print("Connected to kRPC (ESP32 Control Pad).")
            return connection
        except Exception as exc:
            print(f"Waiting for the kRPC server... ({exc})")
            time.sleep(KRPC_RETRY_SECONDS)


def active_vessel_if_flying(connection):
    """Return the active vessel, None outside flight, and raise if disconnected."""
    scene = connection.krpc.current_game_scene
    if scene != connection.krpc.GameScene.flight:
        return None
    try:
        return connection.space_center.active_vessel
    except Exception:
        return None


def apply_panel_event(vessel, name, active, stage_armed, abort_armed):
    """Apply one parsed ESP32 event and return the updated arm states."""
    if name == "STAGE_ROCKER":
        stage_armed = active
        if vessel is None:
            print(f"Stage {'ARMED' if stage_armed else 'SAFE'} on panel; "
                  "no active vessel.")
        else:
            try:
                vessel.control.stage_lock = not stage_armed
                print(f"Stage {'ARMED' if stage_armed else 'SAFE'} "
                      f"-> stage_lock={not stage_armed}")
            except Exception as exc:
                print(f"Could not set stage_lock: {exc}")

    elif name == "STAGE_FIRE" and active:
        if not stage_armed:
            print("Stage fire ignored -- rocker is SAFE.")
        elif vessel is None:
            print("Stage fire ignored -- no active vessel.")
        else:
            try:
                vessel.control.activate_next_stage()
                print("Stage fired.")
            except Exception as exc:
                print(f"Stage fire failed: {exc}")

    elif name == "ABORT_ROCKER":
        abort_armed = active
        print(f"Abort {'ARMED' if abort_armed else 'SAFE'} "
              "(local panel gate; KSP has no separate abort lock)")

    elif name == "ABORT_FIRE" and active:
        if not abort_armed:
            print("Abort fire ignored -- rocker is SAFE.")
        elif vessel is None:
            print("Abort fire ignored -- no active vessel.")
        else:
            try:
                vessel.control.abort = True
                print("ABORT fired.")
            except Exception as exc:
                print(f"Abort failed: {exc}")

    return stage_armed, abort_armed


def main():
    panel = connect_serial()
    connection = connect_krpc_forever()

    stage_armed = False
    abort_armed = False
    last_led_state = None
    last_flight_state = None

    print("ESP32 control-pad bridge running. Ctrl+C to stop.")
    try:
        while True:
            try:
                vessel = active_vessel_if_flying(connection)
            except Exception as exc:
                print(f"kRPC connection lost: {exc}")
                connection = connect_krpc_forever()
                vessel = None

            in_flight = vessel is not None
            if in_flight != last_flight_state:
                print("Active flight detected." if in_flight
                      else "No active flight; panel controls are inhibited.")
                last_flight_state = in_flight

            line = panel.readline().decode(errors="ignore").strip()
            if line and "," in line:
                name, state = line.split(",", 1)
                stage_armed, abort_armed = apply_panel_event(
                    vessel,
                    name.strip(),
                    state.strip().upper() == "ACTIVE",
                    stage_armed,
                    abort_armed,
                )

            # Reconcile the indicator with KSP's real stage-lock state. Lit
            # means staging is unlocked/armed.
            if vessel is not None:
                try:
                    led_should_be_on = not vessel.control.stage_lock
                    if led_should_be_on != last_led_state:
                        panel.write(b"LED,ON\n" if led_should_be_on
                                    else b"LED,OFF\n")
                        last_led_state = led_should_be_on
                except Exception:
                    pass
            elif last_led_state is not False:
                # Outside flight, fail safe to an unlit stage indicator.
                try:
                    panel.write(b"LED,OFF\n")
                except Exception:
                    pass
                last_led_state = False
    finally:
        try:
            panel.close()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception:
        import traceback
        traceback.print_exc()
        if sys.stdin and sys.stdin.isatty():
            input("\nPress Enter to close...")
