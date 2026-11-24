"""Controlled freshness checks; pipe into the UNO Q Python app container."""
import sys
import time

sys.path.insert(0, '/app/python')
from live_sensor import LiveSensor

sensor = LiveSensor()
assert not sensor.snapshot()['available']
sensor._reading = {
    'available': True, 'temperature': 24.5, 'humidity': 72,
    'source': 'live', 'sensor': 'DHT11', 'pin': 2, 'sample_age_ms': 0,
}
sensor._received = time.monotonic() - 11
sensor._error = None
assert not sensor.snapshot()['available']
sensor._received = time.monotonic()
assert sensor.snapshot()['available']
sensor._error = 'DHT11 read failed.'
assert not sensor.snapshot()['available']
print('PASS: missing, stale and failed readings are unavailable; fresh readings are available.')
