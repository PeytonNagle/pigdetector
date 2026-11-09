# firmware

Owner: Wonhee.

- `node/` nRF52840 sensor node firmware (door and temperature)
- `gateway/` ESP32-S3 gateway firmware (BLE ↔ AWS IoT Core)

Built and flashed by hand; no CI. Wiring, pins, flashing steps and how to read each node's device ID go here.

The gateway certificate, private key and Root CA go in `gateway/secrets.h`, which git ignores. Never commit them.
