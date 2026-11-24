# App Lab guide

This demo includes a custom Brick called **QVAC Local AI**. A Brick is a reusable part of an Arduino App Lab app. Python sends readings to the Brick. QVAC writes an explanation on the same device.

## Run in App Lab

Use App Lab **0.12.0** with App CLI **0.14.1**, or a version that supports custom Brick container builds. The App CLI is App Lab's command line service. The desktop app also needs a supported board, such as an UNO Q or Ventuno Q.

1. Make a ZIP of the `app` folder, as shown in the [README](../README.md#run-it-in-app-lab).
2. Connect your board and import the ZIP into App Lab.
3. Click **Run**. The first build installs packages and downloads a roughly 1 GB model. This can take several minutes.
4. Look for `The demo is ready` in the logs.
5. Open the web view on port **8765**. Sample readings work right away. Live readings need the DHT11 and its sketch, uploaded separately as in [uno-q.md](uno-q.md).

On a 4 GB / 32 GB UNO Q, the default build nearly fills the 10 GB system partition. [deploy/uno-q](../deploy/uno-q/README.md) moves the packages and the model to the user partition, using the App CLI on the board and a separate sketch upload.

Model files stay in a Docker volume, which is saved storage outside the running container. Later starts can reuse them. The ZIP contains source code, not the model or installed packages. Use a source ZIP import; this custom Brick is not a frozen `.ard` release.

## How it works

```text
Browser → Python web view → QVAC service → local Qwen3 model
                ↑        ↑
   QVAC Python Brick    DHT11 reading (sketch → Arduino Bridge)
```

The `app` folder is the importable project. The DHT11 sketch for the microcontroller is in `deploy/uno-q/sketch`, outside the App, and is uploaded separately. `app/python/main.py` starts the sensor reader and the web view once QVAC is ready. `app/bricks/qvac` contains the Python interface and the QVAC service, which runs in a Docker container on the CPU (GPU use on App Lab boards has not been tested). The Python runner publishes port 8765, serves `/live` from the sensor reader, and forwards the page, `/health` and `/sensor` to that service. Any other path gets a 404.

The default service address inside App Lab is `http://qvac_runtime:8765`. The laptop demo uses `http://127.0.0.1:8765`. Both run the same QVAC code and web interface.

Code checks whether each reading is below, within or above the sample targets: **22 to 28°C** and **40 to 70% humidity**. The local model writes the explanation and next step. These targets are examples, not growing advice for a specific crop.

## What has been tested

On **18 November 2026**:

- macOS ARM laptop: model load, browser requests and local answers.
- Linux ARM virtual machine: import with the official App CLI 0.14.1, container build and real QVAC answers through Arduino's Python runner.
- All three sample conditions, web view discovery, browser requests through the Python web view, and build, stop and start through the App Lab backend.

The virtual machine had **4 CPUs and 6 GB RAM**. Its QVAC service used about **1.4 GB RAM** while idle.

On **22 November 2026**, on a physical 4 GB UNO Q with a DHT11 on D2 (test contributed by [EmmanuelHaggai](https://github.com/EmmanuelHaggai), details in [uno-q.md](uno-q.md)):

- Import and container build with the board's App CLI 0.13.0, with the [storage setup](../deploy/uno-q/README.md).
- Sketch compiled on the board and uploaded to the microcontroller with OpenOCD.
- Live readings through Arduino Bridge, refreshing during answers. A live answer took **58.65 s**, a sample answer about **53 s**, and an answer with Wi-Fi off **52 s**. The QVAC service used about **1.6 GB RAM**.

**Still pending:** the desktop App Lab import and **Run** flow on a physical board, and App Lab uploading the sketch itself from `app/sketch`.

## Laptop help

The browser demo needs Node.js 22 or newer. Python is only needed for the optional terminal example below. The tested laptop is macOS ARM; Linux ARM was tested through App Lab. Other laptop platforms have not been verified for this sample.

**The page does not open:** keep the terminal running and wait for `QVAC ready`. The model must finish downloading and loading before the page opens.

**Port 8765 is busy:** stop the other copy with `Ctrl+C`, or run `PORT=8767 npm start` on macOS or Linux and open `http://127.0.0.1:8767`.

**An answer fails:** check the runtime terminal, then retry. Only one model request runs at a time.

With the app running, use Python 3 in a second terminal from the repo folder:

```sh
python3 demo.py --temperature 34 --humidity 25
```

Inside an App Lab app, the Brick's Python interface is:

```python
from qvac import QVAC

qvac = QVAC()
qvac.wait_ready()
answer = qvac.explain_reading(34, 25)
print(answer["explanation"])
print(answer["next_step"])
```

## Sources

- [QVAC SDK source](https://github.com/tetherto/qvac)
- [Create custom Bricks](https://docs.arduino.cc/software/app-lab/bricks/custom-bricks/)
- [App Lab 0.12.0 release notes](https://docs.arduino.cc/software/app-lab/release-notes/release-0-12/)
- [App import and release limits](https://docs.arduino.cc/software/app-lab/apps/manage-apps/)
