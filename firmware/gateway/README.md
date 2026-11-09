# gateway

ESP32-S3 gateway firmware: holds BLE links to both nodes, publishes to AWS IoT Core over MQTT with TLS, routes commands by device ID, and buffers readings during an outage.

Secrets go in `secrets.h` (git-ignored).
