"""Prepare the tested UNO Q user-partition layout. Run on the Arduino only."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-path', type=Path, required=True, help='Path of the imported App, as printed by the import')
    parser.add_argument('--data-dir', type=Path, default=Path('/home/arduino/projects'))
    args = parser.parse_args()

    try:
        model = Path('/proc/device-tree/model').read_bytes()
    except OSError:
        parser.error('Run this utility on the Arduino UNO Q, not the connected computer.')
    if b'Arduino SA,Imola' not in model and b'Arduino UNO Q' not in model:
        parser.error('The running device is not the tested UNO Q platform.')
    if os.getuid() != 1000:
        parser.error('Run as the Arduino account (UID 1000), not through sudo.')

    app = args.app_path.resolve()
    if not app.is_relative_to(Path('/home/arduino/ArduinoApps')):
        parser.error('Pass the imported App under /home/arduino/ArduinoApps, not a source folder.')
    data = args.data_dir.resolve()
    if not data.is_relative_to(Path('/home/arduino')) or not re.fullmatch(r'/[A-Za-z0-9_./-]+', str(data)):
        parser.error('Use a simple absolute data directory under /home/arduino.')
    brick = app / 'bricks/qvac'
    source_runtime = brick / 'runtime'
    runtime = data / 'qvac-runtime'
    if not (app / 'app.yaml').is_file() or not (source_runtime / 'server.mjs').is_file():
        parser.error('Import the App first, then pass the path the import printed.')
    if runtime == source_runtime or runtime.is_relative_to(source_runtime):
        parser.error('The data directory must be outside the imported runtime source.')

    running = subprocess.run(
        ['docker', 'ps', '--filter', f'label=cc.arduino.app.path={app}', '--format', '{{.ID}}'],
        check=True, capture_output=True, text=True,
    )
    if running.stdout.strip():
        parser.error('Stop this imported app before changing its storage configuration.')

    templates = Path(__file__).resolve().parent
    data.mkdir(parents=True, exist_ok=True)
    for name in ['qvac-models', 'qvac-npm-cache']:
        (data / name).mkdir(exist_ok=True)
    shutil.copytree(
        source_runtime, runtime, dirs_exist_ok=True,
        ignore=shutil.ignore_patterns('node_modules', '.cache', '__pycache__', '*.before-unoq-storage'),
    )

    for target in [brick / 'brick_compose.yaml', source_runtime / 'Dockerfile']:
        backup = target.with_name(target.name + '.before-unoq-storage')
        if not backup.exists():
            shutil.copy2(target, backup)

    compose = (templates / 'brick_compose.yaml').read_text()
    compose = compose.replace('/home/arduino/projects/', str(data) + '/')
    (brick / 'brick_compose.yaml').write_text(compose)
    shutil.copy2(templates / 'Dockerfile', source_runtime / 'Dockerfile')
    print(f'Prepared imported app: {app}')
    print(f'Runtime, npm cache and models: {data}')
    print('Build the lightweight image and install dependencies before starting the app.')


if __name__ == '__main__':
    main()
