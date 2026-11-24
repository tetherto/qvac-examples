# Optional UNO Q storage setup

On the tested 4 GB / 32 GB UNO Q, Linux has a system partition of about 10 GB and a user partition (`/home/arduino`) of about 18 GB. Building the QVAC service the default way puts about 2.6 GB of packages and 0.9 GB of npm cache on the system partition, which left it with less than 1 GB free. This folder moves the packages, the npm cache and the model to the user partition. With it, the system partition kept about 3.8 GB free.

The setup is opt-in. The App's own `Dockerfile` and `brick_compose.yaml` keep the default layout. `prepare_storage.py` runs only on an UNO Q, as the `arduino` user, and refuses to touch an App that is running. It installs nothing, starts no container, flashes nothing and leaves the partitions as they are.

## Files

- `Dockerfile`: a light Node 22 image with the system libraries only. Packages are installed into a mounted folder in a separate step.
- `brick_compose.yaml`: the QVAC service with its runtime, npm cache and model folders on the user partition.
- `prepare_storage.py`: copies these two templates into an imported App, keeps backups of the originals (`*.before-unoq-storage`) and creates the data folders.

## Steps, on the board

Run these as the `arduino` user, in a shell on the board (for example `adb shell`), with this repository cloned on the board.

1. Import the App with the board's App CLI and note the path it prints. The ZIP holds the `app` folder only; the sketch is uploaded in step 4:

   ```sh
   cd qvac-arduino-brick-demo
   python3 - <<'PY'
   from pathlib import Path
   import zipfile
   root = Path('app')
   with zipfile.ZipFile('arduino-brick-demo-linux.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
       for path in root.rglob('*'):
           relative = path.relative_to(root)
           if not path.is_file():
               continue
           if any(part in {'.cache', '__pycache__', 'node_modules'} for part in relative.parts):
               continue
           if path.name.startswith('.env'):
               continue
           archive.write(path, relative)
   PY
   arduino-app-cli app import arduino-brick-demo-linux.zip
   ```

2. Prepare the storage before the first start. `APP_PATH` is the path printed by the import, `APP_NAME` its last folder name:

   ```sh
   APP_PATH=/home/arduino/ArduinoApps/<your-app>
   APP_NAME=$(basename "$APP_PATH")
   python3 deploy/uno-q/prepare_storage.py --app-path "$APP_PATH"
   ```

   This creates `/home/arduino/projects/qvac-runtime`, `qvac-npm-cache` and `qvac-models`.

3. Build the image, install the packages and start the App:

   ```sh
   docker compose -p "$APP_NAME" -f "$APP_PATH/bricks/qvac/brick_compose.yaml" build qvac_runtime
   docker compose -p "$APP_NAME" -f "$APP_PATH/bricks/qvac/brick_compose.yaml" \
     run --rm --no-deps qvac_runtime npm ci --omit=dev --no-audit --no-fund
   arduino-app-cli app start "user:$APP_NAME" --verbose
   ```

   The Compose project name must match the App name, so the App CLI reuses the same image and model volume. The first start downloads the model (about 1 GB) and can take several minutes.

4. Compile and upload the sketch to the microcontroller as described in [docs/uno-q.md](../../docs/uno-q.md#sketch-upload). Until the sketch sends valid readings, live mode shows an error and never falls back to sample values.

## Check the layout

```sh
df -h / /home/arduino
du -sh /home/arduino/projects/qvac-runtime/node_modules
curl http://127.0.0.1:8765/live
```

The templates mount only the three folders above: no Docker socket and no credentials.

The service runs the copy of `runtime/` that `prepare_storage.py` made in `qvac-runtime`. After you update the App, stop it and run `prepare_storage.py` again so that copy matches.
