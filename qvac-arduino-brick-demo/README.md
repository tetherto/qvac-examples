# QVAC Arduino App Lab Brick Demo

<picture>
  <source media="(prefers-color-scheme: dark)"  srcset="docs/badges/built-with-qvac-dark-mode-landscape.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/badges/built-with-qvac-light-mode-landscape.svg">
  <img alt="Built with QVAC" src="docs/badges/built-with-qvac-light-mode-landscape.svg" width="200">
</picture>

A custom Brick for [Arduino App Lab](https://docs.arduino.cc/software/app-lab/) that lets an App ask a local language model for an answer. Inside the Brick, a small container runs **`@qvac/sdk`** with Qwen3 1.7B on the CPU. Your App's Python code calls it like any other Brick. There is no API key and no cloud AI service.

The example App uses it to explain greenhouse readings: the model says what a temperature and a humidity mean and suggests what to check next. On an Arduino UNO Q, it reads a real DHT11 sensor. On a laptop, or without the sensor, you pick sample readings. The App never acts on hardware.

## What you get

- **A reusable QVAC Brick** (`app/bricks/qvac`): a Python class with `wait_ready()`, `complete(prompt)` and `explain_reading(temperature, humidity)`, backed by a QVAC service in a Docker container.
- **A web page** with a live mode on the board and three sample moments (calm morning, hot afternoon, cool evening) with two sliders. One click asks the local model for an explanation and a next step.
- **Live readings on an UNO Q**: a sketch (`deploy/uno-q/sketch`, uploaded to the microcontroller separately) that reads a DHT11 on pin D2 and hands each reading to Python through Arduino Bridge. See [docs/uno-q.md](docs/uno-q.md).
- **A laptop mode** that runs the same service and page with `npm start`, with no board and no App Lab, plus a Python script that asks from the terminal.

## How it works

```text
Browser -> Python web view -> QVAC service (Docker) -> Qwen3 1.7B on the CPU
                 ^        ^
   QVAC Python Brick      live DHT11 reading (sketch on the microcontroller -> Arduino Bridge)
```

1. **The Brick.** App Lab runs the Brick's Python code inside the App's main container, and starts the service from `brick_compose.yaml` next to it. The service (`runtime/server.mjs`) loads the model once with `loadModel` and answers on port 8765.
2. **The sensor.** On the board, the sketch reads the DHT11 every 2.5 seconds and Python fetches each reading through Arduino Bridge. A live request explains that snapshot, never numbers sent by the browser. A missing or stale reading shows an error instead of a sample.
3. **The facts.** Code checks each reading against example targets (22 to 28 C, 40 to 70% humidity) and writes the status into the prompt, so the model never has to work out whether 34 C is too hot.
4. **The answer.** `completion` returns a JSON object with `explanation` and `next_step`, forced by a JSON schema. The page shows both, with the reading explained, the model, the SDK version and the time it took.

## Why local AI matters here

A board project often runs where the connection is poor: a greenhouse, a classroom, a workshop, a hackathon table. The model answers from the machine the App runs on, so the data stays there and nothing depends on an outside service or a key that can expire. After the first model download, answers need no network: on the UNO Q, an answer was tested with Wi-Fi off.

## Recommended hardware

- Node.js 22 or newer. Python 3 only for the optional terminal example.
- Disk: about 1 GB for the model (`QWEN3_1_7B_INST_Q4`, Qwen3 1.7B in Q4), downloaded once.
- Memory: the QVAC service used about 1.4 GB of RAM idle in a Linux ARM virtual machine and about 1.6 GB on a 4 GB UNO Q. Plan for 4 GB or more.
- Speed, on the CPU: a few seconds per answer on a laptop, about a minute on a 4 GB UNO Q (58.65 s for a live reading). GPU use has not been tested on App Lab boards.
- Tested on a macOS ARM laptop, on Linux ARM (the App Lab runtime in a virtual machine), and, by a community member, on a 4 GB UNO Q with a DHT11 module (see Status below). Other platforms have not been verified.

## Install and run on a laptop

No Arduino board is needed for this mode.

```sh
git clone https://github.com/tetherto/qvac-examples.git
cd qvac-examples/qvac-arduino-brick-demo
npm run setup
npm start
```

Keep internet access on until the terminal says `QVAC ready` (the first run downloads the model), then open **[http://127.0.0.1:8765](http://127.0.0.1:8765)**.

1. Choose **Hot afternoon**.
2. Click **Explain these readings**.
3. Read the explanation and **What to check next**. Try **Cool evening** too.

Stop with `Ctrl+C`. Next time, `npm start` is enough.

With the app running, ask from the terminal in a second window:

```sh
python3 demo.py --temperature 34 --humidity 25
```

## Run it in App Lab

You need a supported board, such as an UNO Q, and App Lab 0.12.0 or newer. For live readings, wire a DHT11 module to GND, 3.3V and D2 ([wiring](docs/uno-q.md#wiring)).

1. Make a ZIP of the App: `cd app && zip -r ../arduino-brick-demo.zip . && cd ..`
2. In App Lab, open **Apps**, click **Create new App +**, choose **Import or install App** and drop the ZIP.
3. Click **Run**. The first build installs packages and downloads the model, which can take several minutes. Wait for `The demo is ready` in the logs.
4. Open the web view on port **8765**. Sample readings work right away. For live readings, wire the DHT11 and upload the sketch as in [docs/uno-q.md](docs/uno-q.md#sketch-upload): the page switches to **Live DHT11** at the first reading.

On a 4 GB / 32 GB UNO Q, the default build nearly fills the 10 GB system partition: [deploy/uno-q](deploy/uno-q/README.md) moves the packages and the model to the user partition, using the App CLI on the board and a separate sketch upload.

**Status:** [EmmanuelHaggai](https://github.com/EmmanuelHaggai) ran the live sensor version on a physical 4 GB UNO Q with a DHT11 on 22 November 2026. He imported the App with the board's App CLI, used the storage setup above and uploaded the sketch by hand ([docs/uno-q.md](docs/uno-q.md)). The code in this folder is adapted from his version and its sketch compiles for the UNO Q, but it has not been rerun on a board since. The desktop App Lab **Run** button, which compiles and uploads the sketch itself, has not been tested with this sketch on a board. Earlier, the sample-only App was imported, built and run with App CLI 0.14.1 in a Linux ARM virtual machine.

## Use the Brick in your own App

1. Copy `app/bricks/qvac` into the `bricks/` folder of your App.
2. Add it to your `app.yaml`:

   ```yaml
   bricks:
     - qvac:
         variables:
           QVAC_URL: http://qvac_runtime:8765
   ```

3. Call it from `python/main.py`:

   ```python
   from qvac import QVAC

   qvac = QVAC()
   qvac.wait_ready()
   answer = qvac.complete("In one sentence, what does a soil moisture of 18% mean?")
   print(answer["text"])
   ```

`complete` takes a prompt of 1 to 3,000 characters and returns `explanation`, `next_step` and `text` (both joined). It shares the greenhouse system prompt and JSON schema with `/sensor`: to make the Brick do something else, change the `system` message and the `responseFormat` schema in `runtime/server.mjs`. Only one request runs at a time: a second one gets a "try again shortly" error.

## Project structure

```text
app/                         the importable App Lab project
  app.yaml                   App manifest, registers the qvac Brick
  python/main.py             starts the sensor reader, then the web view
  python/live_sensor.py      reads the sketch through Arduino Bridge, rejects stale readings
  bricks/qvac/
    brick_config.yaml        Brick id, name, port 8765, QVAC_URL
    brick_compose.yaml       the QVAC service and its model volume
    __init__.py              the Python class your App imports
    webview.py               serves the page and /live, forwards /health and /sensor
    runtime/
      server.mjs             loads the model, answers /health, /sensor, /complete
      sensor.mjs             reading checks and the prompt
      ui/                    the web page
deploy/uno-q/                optional storage setup for a 4 GB UNO Q
  sketch/                    DHT11 reader for the microcontroller, pinned libraries
demo.py                      terminal example for laptop mode
docs/app-lab.md              App Lab guide and test details
docs/uno-q.md                wiring, live readings, board test results
docs/verification/           raw records of the board test
tools/hardware/              checks to run on the board
```

## Known limits

- Live readings were tested with a DHT11 module on D2 only. Without the board, readings are samples.
- About a minute per answer on an UNO Q's CPU. GPU use has not been tested.
- The targets are examples, not growing advice for a specific crop. The App takes no hardware action.
- In App Lab, the web view listens on your local network. It serves `/live`, forwards only the page, `/health` and JSON `POST /sensor`, and refuses other content types. Prompts of your own go through the Brick's Python class.

## Credits

Live DHT11 support on the UNO Q and the board test: [EmmanuelHaggai](https://github.com/EmmanuelHaggai).

## About this example

This example is not an official Arduino integration. Arduino, App Lab and UNO Q are names of Arduino S.r.l., used here only to say what the example works with.

## License

The sample code in this folder is under the [Apache License 2.0](LICENSE), like the QVAC SDK. The live sensor support was contributed under the MIT License, whose notice is kept in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Fonts, model and brand assets keep their own terms: see the same file.
