# Models

This app runs three AI models, all on the QVAC SDK. Two of them are local ONNX files that
live in this directory. They are **not committed** to this repository, for two reasons:

1. **Licensing.** Both ONNX models are produced with [Ultralytics](https://github.com/ultralytics/ultralytics),
   which is **AGPL-3.0**. This example is Apache-2.0, so it cannot ship Ultralytics-derived
   weights. You generate them yourself with the scripts in `export/`, under Ultralytics' own
   license terms.
2. **Size.** The object model is larger than GitHub's per-file limit.

The third model (the Qwen3-VL vision-language model) is **not** in this directory at all: the
QVAC SDK downloads it from the QVAC registry on first run and caches it in your home folder.

| File | What it is | How to get it |
|------|------------|---------------|
| `yolo-world.onnx` | Open-vocab object detector (YOLO-World), ~110 curated classes. Raw output `[1, 4+NC, 8400]`; NMS is done in JS in `detector/detector.mjs`. | Run `export/export-yolo-world.py` (below). |
| `yolo_hand_pose.onnx` | Hand detector + 21 keypoints, used for gestures and the games. End-to-end output `[1, 300, 69]` = `x1,y1,x2,y2,score,class,(kx,ky,kc)*21`. | Run `export/export-hand-pose.py` (below). |
| Qwen3-VL 2B (GGUF) | Scene narration. | Downloaded automatically by the QVAC SDK on first run. Nothing to do. |

After generating both files, this directory should contain `yolo-world.onnx` and
`yolo_hand_pose.onnx`, and `npm start` will load them.

## One-time Python setup

The export scripts need Python 3.11 or 3.12 (Ultralytics needs PyTorch wheels, which are not
yet published for very new Python builds). [`uv`](https://docs.astral.sh/uv/) keeps it isolated:

```bash
cd models/export
uv venv --python 3.11 venv
uv pip install --python venv/bin/python ultralytics onnx onnxslim onnxruntime
# YOLO-World's set_classes() needs CLIP; the venv has no pip, so install it explicitly:
uv pip install --python venv/bin/python "git+https://github.com/ultralytics/CLIP.git" ftfy regex
```

## 1. Object model (`yolo-world.onnx`)

```bash
./venv/bin/python export-yolo-world.py                      # yolov8m-worldv2 (default)
# or, faster and smaller, slightly less accurate:
./venv/bin/python export-yolo-world.py yolov8s-worldv2.pt
mv yolov8*-worldv2.onnx ../yolo-world.onnx
```

The recognised classes (the `VOCAB`) are defined at the top of `export-yolo-world.py`. If you
edit them, keep the `LABELS` array in `detector/detector.mjs` in sync (the script also writes a
`vocab.js` you can paste from). Export with `nms=False` (the script already does): the
embedded-NMS export crashes the CoreML execution provider on empty frames, so the detector does
NMS in JavaScript on the raw output instead.

## 2. Hand model (`yolo_hand_pose.onnx`)

This is a YOLO-pose model trained for **21 hand keypoints**. Ultralytics publishes a
[`hand-keypoints`](https://docs.ultralytics.com/datasets/pose/hand-keypoints/) dataset (21 kpts)
you can train on:

```bash
# train a small hand-pose model (or bring your own 21-keypoint .pt)
./venv/bin/yolo pose train data=hand-keypoints.yaml model=yolo11n-pose.pt epochs=100 imgsz=640
# then export it to the shape the detector expects ([1, 300, 69]):
./venv/bin/python export-hand-pose.py runs/pose/train/weights/best.pt
mv best.onnx ../yolo_hand_pose.onnx
```

Any 21-keypoint YOLO-pose model works as long as it is exported end-to-end (`nms=True`) so the
output is `[1, 300, 69]`. If you change the keypoint count or output layout, update the hand
parsing in `detector/detector.mjs`.
