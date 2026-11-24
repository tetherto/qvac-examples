# Live readings on an Arduino UNO Q

The App can explain real readings from a **DHT11** temperature and humidity sensor wired to an UNO Q, next to the sample mode. The board's microcontroller reads the sensor and the board's Linux side runs QVAC on its CPU: no reading or prompt goes to a cloud service.

Live sensor support and the board test below were contributed by [EmmanuelHaggai](https://github.com/EmmanuelHaggai).

## Board test

Tested on **22 November 2026** on a 4 GB UNO Q with a DHT11 module on D2. Every install, build, upload and answer ran on the board. The code in this folder is adapted from that tested version and its sketch compiles for the UNO Q, but it has not been rerun on a board since.

| What | Result |
| --- | --- |
| Live reading explained (24.1°C, 73% humidity) | **58.65 s** |
| Sample readings explained (three presets) | 52.7 to 53.1 s each |
| Answer with Wi-Fi off, after the model download | 52.15 s |
| Generation speed | about 2.9 tokens/s |
| QVAC service memory | about 1.6 GB |
| Model download and first load (`loadMs`) | about 6.7 minutes |
| Sketch size, as compiled for the test | 81,568 bytes of program storage (10%), 29,514 bytes of RAM (11%) |

On a laptop, the same model gives the same kind of answer in a few seconds. On the UNO Q's CPU it takes about a minute. GPU use on the board has not been tested.

The raw results are in [verification/](verification/): the live run with its readings and answer, the three sample runs and the offline run, and the sketch compile and upload logs.

| Part | Version used in the test |
| --- | --- |
| Board | UNO Q, 4 GB RAM, 32 GB storage, Debian 13 |
| Arduino App CLI | 0.13.0 |
| Arduino CLI | 1.5.1 |
| Microcontroller core | `arduino:zephyr` 0.90.0 |
| Libraries | Arduino_RouterBridge 0.4.3, DHT sensor library 1.4.6, Adafruit Unified Sensor 1.1.15 |
| AI | QVAC SDK 0.24.0, Qwen3 1.7B Q4, CPU |

## Wiring

Power the board off before wiring. Pin order differs between modules: follow the labels on yours.

| DHT11 module | UNO Q |
| --- | --- |
| GND or - | GND |
| VCC or + | 3.3V |
| DATA or S | D2 |

Only a three-pin DHT11 module was tested. A bare sensor may need a pull-up resistor on DATA.

## How it works

```text
DHT11 on D2 -> sketch on the microcontroller (reads every 2.5 s)
            -> Arduino Bridge call "dht11_reading"
            -> live_sensor.py on Linux (checks and keeps the last reading)
            -> GET /live (the page refreshes) and POST /sensor (the reading QVAC explains)
            -> QVAC service -> Qwen3 1.7B on the CPU
```

- `deploy/uno-q/sketch/sketch.ino` reads the sensor every 2.5 seconds and answers the Bridge call `dht11_reading` with a small JSON object. Library versions are pinned in `deploy/uno-q/sketch/sketch.yaml`. It sits outside `app/`, so the App's ZIP stays the sample version and the sketch is uploaded on its own.
- `app/python/live_sensor.py` polls that call in a background thread. A failed reading, a value out of the DHT11's range or a reading older than 10 seconds makes live mode unavailable. It never replaces a missing reading with a sample.
- The web view (`app/bricks/qvac/webview.py`) adds `GET /live`. For `POST /sensor` with `source: live`, it sends QVAC the sensor's own snapshot and ignores any numbers from the browser. The QVAC service accepts live readings only when `brick_compose.yaml` sets `QVAC_ACCEPT_LIVE=1`, so the laptop version refuses them.
- The page starts in sample mode and switches to **Live DHT11** at the first valid reading.
- Each answer names the reading it explains and when it was captured. The display keeps refreshing while the model works, so it can show a newer reading than the one explained.

## Run it on the board

The tested route used the App CLI on the board and a separate microcontroller upload:

1. Import the App and move its storage to the user partition, as described in [deploy/uno-q/README.md](../deploy/uno-q/README.md). Building the QVAC service the default way nearly filled the board's 10 GB system partition.
2. Compile and upload the sketch (below).
3. Open `http://<board-ip>:8765`. The page switches to **Live DHT11** at the first reading. Check that it refreshes, then click **Explain these readings**. **Sample data** brings back the presets and sliders.

App Lab's **Run** button compiles and uploads a sketch placed in `app/sketch` for you. That route has not been tested with this sketch on a board, which is why the sketch lives in `deploy/uno-q/sketch`.

### Sketch upload

From the `qvac-arduino-brick-demo` folder on the board, install the sensor library and compile:

```sh
arduino-cli lib install "DHT sensor library@1.4.6"
arduino-cli compile --fqbn arduino:zephyr:unoq \
  --build-path /home/arduino/projects/dht11-build \
  deploy/uno-q/sketch
```

The board's older `arduino-flash` helper used a different sketch address from core 0.90.0, so the test uploaded with the core's own OpenOCD configuration. `CORE_DIR` is the `arduino_zephyr_0.90.0_*` folder under `/home/arduino/.arduino15/internal` that the compile used:

```sh
CORE_DIR=/home/arduino/.arduino15/internal/arduino_zephyr_0.90.0_<id>
BUILD_DIR=/home/arduino/projects/dht11-build
/opt/openocd/bin/openocd -d2 -s /opt/openocd \
  -f openocd_gpiod.cfg \
  -c "set filename0 $CORE_DIR/firmwares/zephyr-arduino_uno_q_stm32u585xx.elf" \
  -c "set filename1 $BUILD_DIR/sketch.ino.elf-zsk.bin" \
  -f "$CORE_DIR/variants/arduino_uno_q_stm32u585xx/flash_sketch.cfg"
```

Only the microcontroller was flashed. Linux on the board was not reflashed or formatted.

## Limits

- Only a DHT11 on D2 was tested. Other sensors or pins need their own test.
- The targets (22 to 28°C, 40 to 70% humidity) are examples, not advice for a specific crop.
- The App explains readings. It does not switch fans, pumps or heaters.
- Missing and stale readings were tested with controlled inputs (see [tools/hardware](../tools/hardware/README.md)), not by unplugging the sensor.
