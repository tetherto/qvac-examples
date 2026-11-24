"""Read the MCU's DHT11 through Bridge; never substitute simulated data."""
import json
import math
import threading
import time
from datetime import datetime, timezone
from arduino.app_utils import Bridge

INVALID_RESPONSE = 'Invalid sensor response.'
NOT_READING = 'DHT11 is not returning readings.'
BRIDGE_FAILED = 'Cannot read DHT11 through Arduino Bridge. Check the sensor on D2.'


def check_reading(value):
    """Return (reading, None) for a valid Bridge answer, or (None, message) explaining why not.

    The messages are fixed strings or the sketch's own short error text, never exception text,
    because they are served on the local network by GET /live."""
    try:
        reading = json.loads(value) if isinstance(value, (str, bytes)) else value
    except (ValueError, RecursionError):
        return None, INVALID_RESPONSE
    if not isinstance(reading, dict):
        return None, INVALID_RESPONSE
    if not reading.get('ok'):
        error = reading.get('error')
        return None, error if isinstance(error, str) and 0 < len(error) <= 200 else NOT_READING
    t, h = reading.get('temperature'), reading.get('humidity')
    if not all(isinstance(v, (float, int)) and not isinstance(v, bool) and math.isfinite(v) for v in (t, h)):
        return None, 'DHT11 returned invalid readings.'
    if not 0 <= t <= 50 or not 0 <= h <= 100:
        return None, 'DHT11 readings are outside its expected range.'
    age = reading.get('sample_age_ms', 0)
    if isinstance(age, bool) or not isinstance(age, (float, int)) or not 0 <= age <= 10000:
        return None, 'The DHT11 reading is stale.'
    sequence = reading.get('sequence')
    return {'temperature': t, 'humidity': h, 'age': age,
            'sequence': sequence if isinstance(sequence, int) and not isinstance(sequence, bool) else None}, None


class LiveSensor:
    def __init__(self):
        self._lock = threading.Lock()
        self._reading = None
        self._received = 0
        self._error = 'Waiting for the first DHT11 reading from D2.'

    def start(self):
        threading.Thread(target=self._poll, name='dht11-reader', daemon=True).start()

    def _poll(self):
        while True:
            try:
                value = Bridge.call('dht11_reading', timeout=3)
            except Exception:  # Bridge errors vary by version; the reason is logged, not served.
                checked, error = None, BRIDGE_FAILED
            else:
                checked, error = check_reading(value)
            with self._lock:
                was_ok = self._error is None
                if checked:
                    captured = datetime.fromtimestamp(time.time() - checked['age'] / 1000, timezone.utc)
                    self._reading = {'available': True, 'temperature': checked['temperature'],
                                     'humidity': checked['humidity'], 'source': 'live', 'sensor': 'DHT11',
                                     'pin': 2, 'sequence': checked['sequence'],
                                     'capturedAt': captured.isoformat(timespec='milliseconds'),
                                     'sample_age_ms': checked['age']}
                    self._received = time.monotonic()
                    self._error = None
                else:
                    self._error = error
                now_ok = self._error is None
            if was_ok != now_ok:
                print('DHT11 live readings available.' if now_ok else f'DHT11 unavailable: {error}', flush=True)
            time.sleep(2.5)

    def snapshot(self):
        with self._lock:
            if self._error:
                return {'available': False, 'source': 'live', 'sensor': 'DHT11', 'pin': 2, 'error': self._error}
            reading = dict(self._reading)
            reading['ageMs'] = round(reading.pop('sample_age_ms') + (time.monotonic() - self._received) * 1000)
        if reading['ageMs'] > 10000:
            return {'available': False, 'source': 'live', 'sensor': 'DHT11', 'pin': 2, 'error': 'No fresh DHT11 reading. Check the sensor on D2.'}
        return reading
