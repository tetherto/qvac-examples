# Models

This app runs two AI models, both on the QVAC SDK.

The object detector is a local ONNX file that lives in this directory. It is **not committed**
to this repository, for two reasons:

1. **Licensing.** The ONNX model is produced with [Ultralytics](https://github.com/ultralytics/ultralytics),
   which is **AGPL-3.0**. This example is Apache-2.0, so it cannot ship Ultralytics-derived
   weights. You generate it yourself with the script in `export/`, under Ultralytics' own
   license terms.
2. **Size.** The model is larger than GitHub's per-file limit.

The second model (the Qwen3-VL vision-language model) is **not** in this directory at all: the
QVAC SDK downloads it from the QVAC registry on first run and caches it in your home folder.

| File | What it is | How to get it |
|------|------------|---------------|
| `yolov10m.onnx` | Object detector (YOLOv10-M), COCO-80 classes (person, car, truck, bus, dog, cat, bird, backpack, handbag, suitcase, ...). End-to-end output `[1, 300, 6]` = `x1,y1,x2,y2,score,class` in 640px space, NMS-free. | Run `export/export-yolov10.py` (below). |
| Qwen3-VL 2B (GGUF) | Risk verdict + scene description. | Downloaded automatically by the QVAC SDK on first run. Nothing to do. |

After generating the file, this directory should contain `yolov10m.onnx`, and `npm start` will
load it.

## One-time Python setup

The export script needs Python 3.11 or 3.12 (Ultralytics needs PyTorch wheels, which are not
yet published for very new Python builds). [`uv`](https://docs.astral.sh/uv/) keeps it isolated:

```bash
cd models/export
uv venv --python 3.11 venv
uv pip install --python venv/bin/python ultralytics onnx onnxslim onnxruntime
```

## Export the object model (`yolov10m.onnx`)

```bash
./venv/bin/python export-yolov10.py            # yolov10m (default)
# or, faster and smaller, slightly less accurate:
./venv/bin/python export-yolov10.py yolov10s
mv yolov10*.onnx ../yolov10m.onnx
```

YOLOv10 exports end-to-end (NMS-free), so the detector reads the raw `[1, 300, 6]` output
directly. If you swap in a different detector, keep the `LABELS` array and the output parsing
in `detector/detector.mjs` in sync with your model.
