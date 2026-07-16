// Woobie's Mission Control -- ESP32 control panel
// Copyright (c) 2026 SacredWoobie
// SPDX-License-Identifier: MIT
//
// The ESP32 reports debounced switch/button changes over USB serial. All KSP
// logic and safety gates remain in panel_bridge.py on the PC.

#include <Arduino.h>

namespace {

constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint32_t DEBOUNCE_MS = 35;
constexpr size_t MAX_COMMAND_LENGTH = 32;

constexpr uint8_t STAGE_ROCKER_PIN = 4;
constexpr uint8_t STAGE_FIRE_PIN = 18;
constexpr uint8_t ABORT_ROCKER_PIN = 19;
constexpr uint8_t ABORT_FIRE_PIN = 21;
constexpr uint8_t STATUS_LED_PIN = LED_BUILTIN;

// Change these two values if the selected board's built-in LED is active-low.
constexpr uint8_t LED_ON_LEVEL = HIGH;
constexpr uint8_t LED_OFF_LEVEL = LOW;

struct PanelInput {
  uint8_t pin;
  const char* eventName;
  bool reportInitialState;
  bool rawActive;
  bool stableActive;
  uint32_t rawChangedAt;
};

PanelInput inputs[] = {
    {STAGE_ROCKER_PIN, "STAGE_ROCKER", true, false, false, 0},
    {STAGE_FIRE_PIN, "STAGE_FIRE", false, false, false, 0},
    {ABORT_ROCKER_PIN, "ABORT_ROCKER", true, false, false, 0},
    {ABORT_FIRE_PIN, "ABORT_FIRE", false, false, false, 0},
};

String rxBuffer;

bool readActive(uint8_t pin) {
  // INPUT_PULLUP means the input is active when connected to ground.
  return digitalRead(pin) == LOW;
}

void sendState(const char* name, bool active) {
  Serial.print(name);
  Serial.println(active ? ",ACTIVE" : ",INACTIVE");
}

void sendRockerStates() {
  for (const PanelInput& input : inputs) {
    if (input.reportInitialState) {
      sendState(input.eventName, input.stableActive);
    }
  }
}

void initializeInput(PanelInput& input) {
  pinMode(input.pin, INPUT_PULLUP);
  input.rawActive = readActive(input.pin);
  input.stableActive = input.rawActive;
  input.rawChangedAt = millis();

  // Rockers are stateful and must be synchronized after a reset. Fire buttons
  // deliberately are not reported at boot: a held button must be released and
  // pressed again before it can create an action event.
  if (input.reportInitialState) {
    sendState(input.eventName, input.stableActive);
  }
}

void updateInput(PanelInput& input, uint32_t now) {
  const bool currentActive = readActive(input.pin);

  if (currentActive != input.rawActive) {
    input.rawActive = currentActive;
    input.rawChangedAt = now;
  }

  if (input.rawActive != input.stableActive &&
      static_cast<uint32_t>(now - input.rawChangedAt) >= DEBOUNCE_MS) {
    input.stableActive = input.rawActive;
    sendState(input.eventName, input.stableActive);
  }
}

void handleCommand(const String& command) {
  if (command == "LED,ON") {
    digitalWrite(STATUS_LED_PIN, LED_ON_LEVEL);
  } else if (command == "LED,OFF") {
    digitalWrite(STATUS_LED_PIN, LED_OFF_LEVEL);
  } else if (command == "STATE?") {
    // Report stateful controls only. Fire buttons are edge-triggered and must
    // never generate an action merely because the PC reconnected.
    sendRockerStates();
  }
}

void readCommands() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());

    if (c == '\n') {
      rxBuffer.trim();
      handleCommand(rxBuffer);
      rxBuffer = "";
    } else if (c != '\r') {
      if (rxBuffer.length() < MAX_COMMAND_LENGTH) {
        rxBuffer += c;
      } else {
        // Discard an unexpectedly long/malformed command without allowing the
        // String to grow indefinitely.
        rxBuffer = "";
      }
    }
  }
}

}  // namespace

void setup() {
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LED_OFF_LEVEL);

  Serial.begin(SERIAL_BAUD);
  delay(100);

  for (PanelInput& input : inputs) {
    initializeInput(input);
  }

  Serial.println("READY");
}

void loop() {
  const uint32_t now = millis();

  for (PanelInput& input : inputs) {
    updateInput(input, now);
  }

  readCommands();
  delay(1);
}
