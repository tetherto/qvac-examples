import argparse
import json
import math
import os
import time

from qvac import QVAC


def explain(temperature, humidity):
    if not math.isfinite(temperature) or not -50 <= temperature <= 100:
        raise ValueError("Use a temperature between -50 and 100 C.")
    if not math.isfinite(humidity) or not 0 <= humidity <= 100:
        raise ValueError("Use humidity between 0 and 100 percent.")
    return QVAC().explain_reading(temperature, humidity)


def main():
    parser = argparse.ArgumentParser(description="Explain simulated sensor readings with local QVAC.")
    parser.add_argument("--temperature", type=float)
    parser.add_argument("--humidity", type=float)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if (args.temperature is None) != (args.humidity is None):
        parser.error("Pass both --temperature and --humidity.")
    samples = [(25, 55), (34, 25)] if args.temperature is None else [(args.temperature, args.humidity)]
    receipts = []
    if not args.json:
        print("QVAC SENSOR EXPLAINER", flush=True)
        print("Input: simulated sensor readings. Inference: local QVAC on CPU.", flush=True)
        print("Demo targets: 22 to 28 C, 40 to 70% humidity.\n", flush=True)
        print("Waiting for the local QVAC runtime...", flush=True)
    QVAC().wait_ready()
    for temperature, humidity in samples:
        if not args.json:
            print(f"Reading: {temperature:g} C / {humidity:g}% humidity", flush=True)
            print("Asking the local model...", flush=True)
        start = time.monotonic()
        result = explain(temperature, humidity)
        receipts.append({"temperatureC": temperature, "humidityPct": humidity, "source": "simulated", **result})
        if not args.json:
            print(result["text"], flush=True)
            speed = result.get("tokensPerSecond")
            speed_text = f" / {speed:.1f} tokens/s" if speed is not None else ""
            print(f"{result['model']} / {time.monotonic() - start:.2f} s{speed_text}\n", flush=True)
    if args.json:
        print(json.dumps(receipts, indent=2), flush=True)


if __name__ == "__main__":
    try:
        if os.getenv("QVAC_DESKTOP") == "1":
            main()
        else:
            print("Waiting for the local QVAC runtime...", flush=True)
            QVAC().wait_ready()
            check = explain(25, 55)
            print(f"QVAC Brick check: {check['text']}", flush=True)
            QVAC().start_webview()
            print("The demo is ready. Open the web view on port 8765. Inputs are simulated.", flush=True)
    except (ValueError, RuntimeError) as error:
        raise SystemExit(str(error))
    if os.getenv("QVAC_DESKTOP") != "1":
        from arduino.app_utils import App
        App.run()
