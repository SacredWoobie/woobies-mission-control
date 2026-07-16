# ESP32 control-pad protocol

`panel_bridge.py` communicates with the ESP32 over a 115200-baud serial port.
Each message is one UTF-8/ASCII line terminated by `\n`.

The included firmware is `firmware/KSP_control.ino`. It uses only the ESP32
Arduino core and does not require third-party Arduino libraries. It has been
compiled and uploaded successfully to an ESP32-WROOM-32 DevKit V1.

## Pin assignment and wiring

| Function | GPIO | Wiring |
| --- | ---: | --- |
| Stage arm/safe rocker | 4 | Switch between GPIO and ground |
| Stage fire button | 18 | Momentary button between GPIO and ground |
| Abort arm/safe rocker | 19 | Switch between GPIO and ground |
| Abort fire button | 21 | Momentary button between GPIO and ground |
| Stage-lock status | `LED_BUILTIN` | Board's built-in LED |

All four controls use `INPUT_PULLUP`: open is inactive and connection to ground
is active. The firmware assumes the built-in LED is active-high. If the selected
ESP32 board uses an active-low LED, swap `LED_ON_LEVEL` and `LED_OFF_LEVEL` near
the top of the sketch.

## ESP32 to PC

The format is:

```text
EVENT_NAME,STATE
```

Supported messages are:

| Message | Effect |
| --- | --- |
| `STAGE_ROCKER,ACTIVE` | Arms staging locally and unlocks staging in KSP. |
| `STAGE_ROCKER,INACTIVE` | Safes staging locally and locks staging in KSP. |
| `STAGE_FIRE,ACTIVE` | Activates the next stage only while staging is armed. |
| `ABORT_ROCKER,ACTIVE` | Arms the local abort gate. |
| `ABORT_ROCKER,INACTIVE` | Safes the local abort gate. |
| `ABORT_FIRE,ACTIVE` | Activates KSP's abort action group only while abort is armed. |

Unknown events are ignored. Button-release messages for the fire buttons may be
sent, but only `ACTIVE` triggers an action.

At startup, and whenever the bridge sends `STATE?`, the firmware reports the two
rocker states so the Python bridge is synchronized. It deliberately does not
report an initially held fire button; the button must be released and pressed
again after reset. Inputs must remain stable for 35 ms before a state change is
sent.

## PC to ESP32

The bridge sends the stage-lock indicator state:

| Message | Meaning |
| --- | --- |
| `LED,ON` | KSP staging is unlocked/armed. |
| `LED,OFF` | KSP staging is locked, or there is no active flight. |
| `STATE?` | Requests fresh stage- and abort-rocker states; fire buttons are never reported in response. |

## Uploading the firmware

1. Install Arduino IDE and Espressif's ESP32 Arduino board support.
2. Open `firmware/KSP_control.ino`.
3. Select `DOIT ESP32 DEVKIT V1` as the board and select its USB serial port.
4. Compile and upload the sketch.
5. Open Serial Monitor at 115200 baud. Resetting the board should print the two
   rocker states followed by `READY`.

This sketch has been compiled and installed on the development panel. Confirm
the built-in LED polarity and all four GPIO mappings during the final physical
control test.
