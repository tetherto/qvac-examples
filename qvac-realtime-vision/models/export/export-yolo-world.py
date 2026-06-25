# Re-export the QVAC Realtime object detector (YOLO-World open-vocab -> ONNX for @qvac/onnx).
#
# Setup (one-time, isolated; newer Python builds may not have PyTorch wheels yet):
#   uv venv --python 3.11 venv
#   uv pip install --python venv/bin/python ultralytics onnx onnxslim onnxruntime
#   uv pip install --python venv/bin/python "git+https://github.com/ultralytics/CLIP.git" ftfy regex
# Run:
#   ./venv/bin/python export-yolo-world.py                      # -> yolov8m-worldv2.onnx
#   ./venv/bin/python export-yolo-world.py yolov8s-worldv2.pt   # faster, less accurate
# Then copy the .onnx to ../yolo-world.onnx and keep detector.mjs LABELS in sync with VOCAB.
#
# IMPORTANT: export with nms=False. The embedded-NMS export (nms=True) crashes the CoreML EP
# on empty frames (GatherND with 0 elements). detector.mjs does NMS in JS on the raw
# [1, 4+NC, 8400] output instead, which is robust and still GPU-fast.

import sys, json
from ultralytics import YOLOWorld

# Curated open-vocab for a tech-conference booth (distinct names; synonyms hurt YOLO-World).
# Edit this list to change what the detector recognises, then re-export + update detector.mjs LABELS.
VOCAB = [
  "person","face","hand","glasses","sunglasses","hat","cap","helmet","headphones","earbuds","face mask",
  "phone","laptop","tablet","keyboard","mouse","monitor","tv","camera","microphone","speaker","smartwatch","watch","vr headset","game controller","remote","drone",
  "charger","cable","usb drive","power bank","battery",
  "backpack","handbag","suitcase","wallet","keys","lanyard","badge","id card","credit card","banknote","coin","umbrella",
  "pen","pencil","marker","notebook","book","magazine","paper","sticky note","sticker","business card","folder","scissors","stapler","ruler","envelope","poster","whiteboard",
  "bottle","cup","mug","coffee cup","wine glass","can","banana","apple","orange","sandwich","donut","pizza","cake","candy","chocolate",
  "t-shirt","jacket","hoodie","tie","scarf","gloves","shoe","sneaker","boot",
  "chair","couch","table","desk","lamp","potted plant","clock","picture frame","mirror","shelf","trash can","fan",
  "ball","balloon","teddy bear","toy","dice","flag","gift box","box","tissue","toothbrush","ring","bracelet","necklace",
]
seen = set(); VOCAB = [x for x in VOCAB if not (x in seen or seen.add(x))]
print("VOCAB size:", len(VOCAB))

name = sys.argv[1] if len(sys.argv) > 1 else "yolov8m-worldv2.pt"
m = YOLOWorld(name); m.set_classes(VOCAB)
path = m.export(format="onnx", nms=False, imgsz=640, opset=13, simplify=True)
print("EXPORTED:", path, "(output [1, 4+%d, 8400]; NMS is done in detector.mjs)" % len(VOCAB))
with open("vocab.js", "w") as f: f.write("const LABELS = " + json.dumps(VOCAB) + "\n")
print("wrote vocab.js (paste LABELS into detector.mjs)")
