# UNO Q test records

Raw records from the board test of **22 November 2026** (4 GB UNO Q, DHT11 on D2), contributed by [EmmanuelHaggai](https://github.com/EmmanuelHaggai). They are kept as they were produced, except the test board's host name (removed) and build folder name (renamed), and are not rerun when the code or docs change. The summary is in [../uno-q.md](../uno-q.md). Memory, storage and version figures in that summary and in [deploy/uno-q](../../deploy/uno-q/README.md) come from the contributor's test notes and have no raw record here.

| File | What it shows |
| --- | --- |
| `live-hardware.json` | Three live readings with advancing sequence numbers, a new reading during the answer, and a 58.65 s answer about the measured 24.1°C / 73% while the request sent fake values of 99 |
| `sample-and-offline.json` | The three sample presets (about 53 s each), a refused invalid input, and an answer with Wi-Fi off |
| `sketch-compile.txt` | The sketch compile: 81,568 bytes of program storage, 29,514 bytes of RAM |
| `sketch-upload.txt` | The OpenOCD upload to the STM32 microcontroller |
