# Third-party notices

The Apache 2.0 license covers the sample code in this folder. It does not replace the licenses of dependencies, fonts, models or branding.

- The QVAC SDK is installed from npm and keeps its own Apache 2.0 license. It is not bundled in this folder.
- The Qwen3 model is downloaded by QVAC. Model files are not bundled in this folder.
- Bundled Geist and Geist Mono fonts keep their SIL Open Font License files in `app/bricks/qvac/runtime/ui/assets`.
- The sketch's Arduino libraries (Arduino_RouterBridge, DHT sensor library, Adafruit Unified Sensor and their dependencies) are installed by the Arduino tools and keep their own licenses. They are not bundled in this folder.
- The QVAC name, the QVAC logo and the Built with QVAC badge, and the Arduino name, belong to their respective rights holders. The sample code license does not grant trademark rights.

## Live sensor support

The live DHT11 support for the UNO Q was contributed by [EmmanuelHaggai](https://github.com/EmmanuelHaggai) under the MIT License: `app/python/live_sensor.py`, `deploy/uno-q/` (with the sketch), `tools/hardware/`, the records in `docs/verification/`, and the live mode in the web view, the QVAC service and the page. Those parts are used under this license:

```text
MIT License

Copyright (c) 2026 EmmanuelHaggai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

This is an independent demo, not an official Arduino integration.
