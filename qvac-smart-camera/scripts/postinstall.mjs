// Runs automatically after `npm install`.
// On Windows: the QVAC llama.cpp engine (@qvac/embed-llamacpp) needs two OpenSSL DLLs
// that npm doesn't ship. We copy the bundled ones next to the native addon so the VLM
// loads without manual steps. On macOS/Linux nothing to do (we just print a hint).
// Never fails the install: any error is swallowed and we exit 0.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

try {
  if (process.platform === "win32") {
    const src = path.join(root, "vendor", "win32-x64");
    const dst = path.join(root, "node_modules", "@qvac", "embed-llamacpp", "prebuilds", "win32-x64");
    if (fs.existsSync(src) && fs.existsSync(dst)) {
      let n = 0;
      for (const f of ["libcrypto-3-x64.dll", "libssl-3-x64.dll"]) {
        const from = path.join(src, f), to = path.join(dst, f);
        if (fs.existsSync(from) && !fs.existsSync(to)) { fs.copyFileSync(from, to); n++; }
      }
      console.log(n
        ? `[postinstall] copied ${n} OpenSSL DLL(s) for the QVAC VLM engine`
        : "[postinstall] OpenSSL DLLs already present");
    }
  } else if (process.platform === "darwin") {
    console.log("[postinstall] macOS: if the VLM fails with a libssl/libcrypto error, run: brew install openssl@3");
  }
} catch (e) {
  console.log("[postinstall] skipped:", e && e.message);
}
