import os
from pathlib import Path
import runpy
import sys

root = Path(__file__).resolve().parent
os.environ.setdefault("QVAC_URL", "http://127.0.0.1:8765")
os.environ["QVAC_DESKTOP"] = "1"
sys.path.insert(0, str(root / "app" / "bricks"))
runpy.run_path(str(root / "app" / "python" / "main.py"), run_name="__main__")
