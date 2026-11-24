# Board checks

These scripts checked the live sensor support on an UNO Q. `check_live_api.py` needs only Python 3. The other two run on the board, in a shell as the `arduino` user, with this repository cloned there and the App running.

```sh
cd qvac-arduino-brick-demo
python3 tools/hardware/check_live_api.py
python3 tools/hardware/verify_live.py
docker exec -i <app-name>-main-1 python - < tools/hardware/check_reader.py
```

- `check_live_api.py` loads the App's web view with a fake sensor and a fake QVAC service on loopback ports. It checks that a missing sensor is refused, that measured values replace any values the browser sends, that sample requests still pass through and that a malformed request is refused. It does not touch the real sensor.
- `verify_live.py` reads `/live` three times, checks that the sequence number advances, asks QVAC for a live answer while sending `99` as fake browser values, and checks that the answer uses the measured values and that a new reading arrives during the answer. Allow about a minute. It writes `live-check.json` in the current folder.
- `check_reader.py` runs inside the App's Python container, where `arduino.app_utils` is installed. It checks that a missing, stale (older than 10 seconds) or failed reading is reported as unavailable.

None of them change Wi-Fi settings or flash firmware.
