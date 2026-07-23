#!/usr/bin/env python3
# Export a YOLOv10 COCO detector to ONNX for the QVAC Smart Camera.
#
# YOLOv10 has an end-to-end (NMS-free) head, so the ONNX output is [1, 300, 6]:
# each row is [x1, y1, x2, y2, score, class_id] in 640px input space. That is exactly
# what detector/detector.mjs reads, so no extra post-processing is needed.
#
# Ultralytics is AGPL-3.0. You run this yourself, under Ultralytics' license terms;
# the weights are not shipped with this Apache-2.0 example.
#
# Usage:
#   ./venv/bin/python export-yolov10.py            # yolov10m (default)
#   ./venv/bin/python export-yolov10.py yolov10s   # smaller/faster
#   mv yolov10*.onnx ../yolov10m.onnx
import sys
from ultralytics import YOLO

name = sys.argv[1] if len(sys.argv) > 1 else "yolov10m"
if not name.endswith(".pt"):
    name = name + ".pt"

print(f"[export] loading {name} (downloads the COCO checkpoint on first run)")
model = YOLO(name)

print("[export] exporting to ONNX at imgsz=640")
model.export(format="onnx", imgsz=640, opset=13, simplify=True)

print("[export] done. Move the .onnx into the models/ directory:")
print("         mv yolov10*.onnx ../yolov10m.onnx")
