
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <NimBLEDevice.h>
#include <time.h>
#include <stdint.h>
#include <math.h>
#include "secrets.h"

// ========================================
// PigDetector ESP32-S3 Gateway
// BLE + Wi-Fi + AWS IoT Core
// ========================================

// Actual nRF52840 factory-based ID
const char* DEVICE_ID = "pd-a414476f";

// AWS MQTT topic
const char* MQTT_TOPIC =
  "pigdetector/pd-a414476f/state";

// Temperature control setting
const float TEMP_MAX_C = 18.0f;

// Nordic UART Service
static NimBLEUUID SERVICE_UUID(
  "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
);

// Nordic UART notification characteristic
static NimBLEUUID TX_UUID(
  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
);

// BLE
NimBLEClient* bleClient = nullptr;

// AWS MQTT
WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

// Sensor data structure
struct SensorReading {
  float temperature;
  bool led;
};

// BLE-to-main-loop queue
QueueHandle_t readingQueue = nullptr;

// BLE message buffer
char bleBuffer[80];
size_t bleBufferLength = 0;

// Reconnection timing
unsigned long lastWiFiAttempt = 0;
unsigned long lastMQTTAttempt = 0;
unsigned long lastBLEAttempt = 0;

// ========================================
// Parse complete BLE message
// Expected: TEMP,20.38,LED,ON
// ========================================
void processBLEPacket(const char* packet) {
  float temperature = 0;
  char ledText[8] = {0};

  Serial.print("Complete BLE Message: ");
  Serial.println(packet);

  int parsed = sscanf(
    packet,
    "TEMP,%f,LED,%7s",
    &temperature,
    ledText
  );

  if (parsed != 2 || !isfinite(temperature)) {
    Serial.println("ERROR: Invalid BLE message");
    return;
  }

  if (strcmp(ledText, "ON") != 0 &&
      strcmp(ledText, "OFF") != 0) {
    Serial.println("ERROR: Invalid LED state");
    return;
  }

  SensorReading reading;
  reading.temperature = temperature;
  reading.led = (strcmp(ledText, "ON") == 0);

  if (readingQueue != nullptr) {
    if (xQueueSend(readingQueue, &reading, 0) != pdTRUE) {
      Serial.println("WARNING: BLE reading queue full");
    }
  }
}

// ========================================
// BLE notification callback
// ========================================
void onTemperatureData(
  NimBLERemoteCharacteristic* chr,
  uint8_t* data,
  size_t length,
  bool isNotify
) {
  Serial.print("BLE RAW: ");
  Serial.write(data, length);
  Serial.println();

  for (size_t i = 0; i < length; i++) {
    char c = (char)data[i];

    if (c == '\n') {
      bleBuffer[bleBufferLength] = '\0';

      if (bleBufferLength > 0) {
        processBLEPacket(bleBuffer);
      }

      bleBufferLength = 0;
    }
    else if (c != '\r') {
      if (bleBufferLength < sizeof(bleBuffer) - 1) {
        bleBuffer[bleBufferLength++] = c;
      }
      else {
        bleBufferLength = 0;
        Serial.println("ERROR: BLE buffer overflow");
      }
    }
  }
}

// ========================================
// Connect Wi-Fi
// ========================================
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println("Connecting to WiFi...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi Connected!");

    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  }
  else {
    Serial.println("ERROR: WiFi connection failed");
  }
}

// ========================================
// Sync clock using NTP
// Required for AWS TLS and Unix timestamp
// ========================================
bool syncTime() {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  time_t now = time(nullptr);

  // January 1, 2020 in Unix seconds
  if (now >= 1577836800) {
    return true;
  }

  Serial.println("Synchronizing time with NTP...");

  configTime(
    0,
    0,
    "pool.ntp.org",
    "time.google.com"
  );

  unsigned long start = millis();

  while (millis() - start < 15000) {
    now = time(nullptr);

    if (now >= 1577836800) {
      Serial.println("Time synchronized!");
      return true;
    }

    delay(500);
  }

  Serial.println("ERROR: NTP synchronization failed");
  return false;
}

// ========================================
// AWS MQTT connection
// ========================================
void connectAWS() {
  if (mqttClient.connected()) {
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (!syncTime()) {
    return;
  }

  Serial.println("Connecting to AWS IoT Core...");

  // Must use the exact authorized client ID
  bool success = mqttClient.connect(
    AWS_CLIENT_ID
  );

  if (success) {
    Serial.println("AWS IoT Core MQTT Connected!");
  }
  else {
    Serial.print("AWS MQTT connection failed. State: ");
    Serial.println(mqttClient.state());
  }
}

// ========================================
// Publish AWS-compatible temperature JSON
// ========================================
void publishSensorData(
  const SensorReading& reading
) {
  if (!syncTime()) {
    Serial.println("ERROR: Cannot publish without valid time");
    return;
  }

  // Unix timestamp in MILLISECONDS
  // Must be a JSON number, not a string
  uint64_t timestampMs =
    (uint64_t)time(nullptr) * 1000ULL;

  char json[320];

  int length = snprintf(
    json,
    sizeof(json),

    "{"
      "\"deviceId\":\"%s\","
      "\"type\":\"temp\","
      "\"mode\":\"auto\","
      "\"led\":%s,"
      "\"tempC\":%.2f,"
      "\"limits\":{"
        "\"tempMaxC\":%.2f"
      "},"
      "\"ack\":null,"
      "\"ackErr\":null,"
      "\"ts\":%llu"
    "}",

    DEVICE_ID,
    reading.led ? "true" : "false",
    reading.temperature,
    TEMP_MAX_C,
    (unsigned long long)timestampMs
  );

  if (length < 0 || length >= (int)sizeof(json)) {
    Serial.println("ERROR: JSON formatting failed");
    return;
  }

  Serial.println();
  Serial.println("======== Sensor Data ========");

  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);

  Serial.print("Temperature: ");
  Serial.println(reading.temperature, 2);

  Serial.print("LED: ");
  Serial.println(reading.led ? "ON" : "OFF");

  Serial.print("Timestamp (ms): ");
  Serial.printf("%llu\n",
    (unsigned long long)timestampMs
  );

  Serial.print("JSON: ");
  Serial.println(json);

  if (!mqttClient.connected()) {
    Serial.println("ERROR: AWS MQTT disconnected");
    Serial.println("=============================");
    return;
  }

  bool published = mqttClient.publish(
    MQTT_TOPIC,
    json
  );

  if (published) {
    Serial.println("MQTT publish sent!");
    Serial.print("Topic: ");
    Serial.println(MQTT_TOPIC);
  }
  else {
    Serial.println("ERROR: MQTT publish failed");
  }

  Serial.println("=============================");
}

// ========================================
// Connect to nRF52840 over BLE
// ========================================
void connectBLE() {
  Serial.println("Searching for temperature node...");

  NimBLEScan* scan = NimBLEDevice::getScan();

  scan->setActiveScan(true);

  NimBLEScanResults results =
    scan->getResults(5000, false);

  bool found = false;

  for (int i = 0; i < results.getCount(); i++) {
    const NimBLEAdvertisedDevice* device =
      results.getDevice(i);

    if (!device->isAdvertisingService(SERVICE_UUID)) {
      continue;
    }

    // Match the temperature node by BLE name
    if (!device->haveName() ||
        device->getName() != "PigDetector_Temp") {
      continue;
    }

    found = true;

    Serial.println("Temperature node found!");

    bleClient = NimBLEDevice::createClient();

    if (bleClient == nullptr) {
      Serial.println("ERROR: BLE client creation failed");
      break;
    }

    if (!bleClient->connect(device)) {
      Serial.println("ERROR: BLE connection failed");
      break;
    }

    NimBLERemoteService* service =
      bleClient->getService(SERVICE_UUID);

    if (service == nullptr) {
      Serial.println("ERROR: BLE UART service not found");
      bleClient->disconnect();
      break;
    }

    NimBLERemoteCharacteristic* tx =
      service->getCharacteristic(TX_UUID);

    if (tx == nullptr || !tx->canNotify()) {
      Serial.println("ERROR: BLE notification unavailable");
      bleClient->disconnect();
      break;
    }

    bleBufferLength = 0;

    if (tx->subscribe(true, onTemperatureData)) {
      Serial.println("BLE Connected!");
      Serial.println("Waiting for sensor readings...");
    }
    else {
      Serial.println("ERROR: BLE subscription failed");
      bleClient->disconnect();
    }

    break;
  }

  scan->clearResults();

  if (!found) {
    Serial.println("Temperature node not found");
  }
}

// ========================================
// Setup
// ========================================
void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("==================================");
  Serial.println("PigDetector ESP32-S3 Gateway");
  Serial.println("AWS Schema-Compatible Version");
  Serial.println("==================================");

  readingQueue = xQueueCreate(
    20,
    sizeof(SensorReading)
  );

  if (readingQueue == nullptr) {
    Serial.println("ERROR: Could not create sensor queue");

    while (true) {
      delay(1000);
    }
  }

  // TLS certificates from secrets.h
  secureClient.setCACert(AWS_ROOT_CA);
  secureClient.setCertificate(AWS_DEVICE_CERT);
  secureClient.setPrivateKey(AWS_PRIVATE_KEY);

  // AWS MQTT settings
  mqttClient.setServer(
    AWS_ENDPOINT,
    AWS_PORT
  );

  mqttClient.setBufferSize(512);
  mqttClient.setKeepAlive(30);
  mqttClient.setSocketTimeout(10);

  // Initialize BLE
  NimBLEDevice::init("PigDetector_Gateway");

  connectWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    syncTime();
    connectAWS();
  }

  Serial.println("Gateway Ready");
}

// ========================================
// Main loop
// ========================================
void loop() {
  unsigned long now = millis();

  // Wi-Fi reconnect
  if (WiFi.status() != WL_CONNECTED) {
    if (lastWiFiAttempt == 0 ||
        now - lastWiFiAttempt >= 10000) {

      lastWiFiAttempt = now;
      connectWiFi();
    }
  }

  // MQTT reconnect
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      if (lastMQTTAttempt == 0 ||
          now - lastMQTTAttempt >= 10000) {

        lastMQTTAttempt = now;
        connectAWS();
      }
    }
    else {
      mqttClient.loop();
    }
  }

  // BLE reconnect
  if (bleClient == nullptr ||
      !bleClient->isConnected()) {

    if (lastBLEAttempt == 0 ||
        now - lastBLEAttempt >= 5000) {

      lastBLEAttempt = now;

      if (bleClient != nullptr) {
        NimBLEDevice::deleteClient(bleClient);
        bleClient = nullptr;
      }

      connectBLE();
    }
  }

  // Publish incoming sensor readingss
  SensorReading reading;

  while (xQueueReceive(
    readingQueue,
    &reading,
    0
  ) == pdTRUE) {

    publishSensorData(reading);
  }

  if (mqttClient.connected()) {
    mqttClient.loop();
  }

  delay(20);
}
