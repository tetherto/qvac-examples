// Electron entry point: render the demo's designed graphics and fake app screenshots to PNG with
// Chromium, so the demo folder needs no image files from anywhere else.
//
// Usage (called by make-demo.cjs):  electron demo/make-images.js <jobsJsonPath>
//   jobs: [{ file: "/abs/out.png", width: 1200, height: 675, html: "<!doctype html>..." }]
"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const jobs = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], "utf8"));
  const win = new BrowserWindow({
    show: false, width: 1200, height: 800, useContentSize: true,
    webPreferences: { offscreen: true, javascript: false }
  });
  for (const job of jobs) {
    try {
      win.setContentSize(job.width, job.height);
      await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(job.html));
      await sleep(250); // let the offscreen renderer paint the new size before capturing
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: job.width, height: job.height });
      fs.writeFileSync(job.file, img.toPNG());
      console.log("WROTE " + job.file);
    } catch (e) { console.log("ERROR " + job.file + " :: " + ((e && e.message) || e)); }
  }
  app.exit(0);
});
