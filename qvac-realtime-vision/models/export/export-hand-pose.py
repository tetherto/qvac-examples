# Export a 21-keypoint YOLO-pose hand model to ONNX for @qvac/onnx.
#
# The detector (detector/detector.mjs) expects the END-TO-END (nms=True) layout:
#   output [1, 300, 69] = x1, y1, x2, y2, score, class, (kx, ky, kc) * 21
#
# Setup: see models/README.md (uv venv with ultralytics + onnx + onnxslim + onnxruntime).
# Bring your own 21-keypoint hand .pt (e.g. a YOLO-pose model trained on Ultralytics'
# hand-keypoints dataset), then:
#   ./venv/bin/python export-hand-pose.py path/to/best.pt
#   mv path/to/best.onnx ../yolo_hand_pose.onnx

import sys
from ultralytics import YOLO

pt = sys.argv[1] if len(sys.argv) > 1 else "best.pt"
m = YOLO(pt)
path = m.export(format="onnx", nms=True, imgsz=640, opset=13, simplify=True)
print("EXPORTED:", path, "(expected output [1, 300, 69])")
