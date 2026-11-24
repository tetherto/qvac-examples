#include <Arduino_RouterBridge.h>
#include <DHT.h>

constexpr uint8_t SENSOR_PIN = 2;
constexpr unsigned long SAMPLE_INTERVAL_MS = 2500;
DHT dht(SENSOR_PIN, DHT11);
float temperatureC = NAN;
float humidityPct = NAN;
bool validReading = false;
unsigned long sampledAt = 0;
unsigned long lastAttempt = 0;
unsigned long sequenceNumber = 0;

String getSensorReading() {
  if (!validReading) {
    return "{\"ok\":false,\"sensor\":\"DHT11\",\"pin\":2,\"error\":\"DHT11 read failed. Check DATA on D2, 3.3V power and GND.\"}";
  }
  return String("{\"ok\":true,\"sensor\":\"DHT11\",\"pin\":2,\"temperature\":") +
    String(temperatureC, 1) + ",\"humidity\":" + String(humidityPct, 1) +
    ",\"sample_age_ms\":" + String(millis() - sampledAt) +
    ",\"sequence\":" + String(sequenceNumber) + "}";
}

void setup() {
  dht.begin();
  Bridge.begin();
  Monitor.begin(115200);
  Bridge.provide("dht11_reading", getSensorReading);
  lastAttempt = millis() - SAMPLE_INTERVAL_MS;
  Monitor.println("Live DHT11 on D2, 3.3V, GND");
}

void loop() {
  const unsigned long now = millis();
  if (now - lastAttempt >= SAMPLE_INTERVAL_MS) {
    lastAttempt = now;
    const float h = dht.readHumidity();
    const float t = dht.readTemperature();
    validReading = !isnan(h) && !isnan(t) && h >= 0 && h <= 100 && t >= 0 && t <= 50;
    if (validReading) {
      temperatureC = t;
      humidityPct = h;
      sampledAt = millis();
      ++sequenceNumber;
    }
  }
  delay(10);
}
