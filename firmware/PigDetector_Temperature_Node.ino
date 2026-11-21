
#include <Adafruit_TinyUSB.h>
#include <bluefruit.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// PigDetector nRF52840 Temperature Node

// Hardware pins
const int SENSOR_PIN = 7;
const int LED_PIN = 5;

// Temperature thresholds
const float TEMP_ON = 18.0;
const float TEMP_OFF = 17.0;

// DS18B20
OneWire oneWire(SENSOR_PIN);
DallasTemperature sensors(&oneWire);

// BLE
BLEUart bleuart;

// Device state
bool ledState = false;

// Unique factory-based device ID
char deviceId[16];

void setup() {
  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  sensors.begin();

  // Read the nRF52840 factory device ID
  uint32_t factoryId = NRF_FICR->DEVICEID[0];

  snprintf(
    deviceId,
    sizeof(deviceId),
    "pd-%08lx",
    (unsigned long)factoryId
  );

  // Initialize BLE
  Bluefruit.begin();
  Bluefruit.setName("PigDetector_Temp");

  bleuart.begin();

  Bluefruit.Advertising.addFlags(
    BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE
  );
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(bleuart);
  Bluefruit.ScanResponse.addName();
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.start(0);

  Serial.println("==========================");
  Serial.println("PigDetector Temperature Node");
  Serial.print("Device ID: ");
  Serial.println(deviceId);
  Serial.println("BLE Ready");
  Serial.println("==========================");
}

void loop() {
  sensors.requestTemperatures();

  float temp = sensors.getTempCByIndex(0);

  if (temp == DEVICE_DISCONNECTED_C) {
    Serial.println("ERROR: DS18B20 disconnected");
    delay(2000);
    return;
  }

  // Automatic LED control
  if (temp >= TEMP_ON) {
    ledState = true;
  } else if (temp < TEMP_OFF) {
    ledState = false;
  }

  digitalWrite(LED_PIN, ledState ? HIGH : LOW);

  Serial.print("Device ID: ");
  Serial.println(deviceId);

  Serial.print("Temperature: ");
  Serial.print(temp, 2);
  Serial.print(" C | LED: ");
  Serial.println(ledState ? "ON" : "OFF");

  // Send complete BLE packet
  if (Bluefruit.connected() && bleuart.notifyEnabled()) {
    String packet =
      "TEMP," +
      String(temp, 2) +
      ",LED," +
      String(ledState ? "ON" : "OFF") +
      "\n";

    bleuart.write(
      (const uint8_t*)packet.c_str(),
      packet.length()
    );

    Serial.print("BLE Sent: ");
    Serial.print(packet);
  } else {
    Serial.println("BLE waiting for gateway...");
  }

  delay(2000);
}
