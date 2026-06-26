import { existsSync, readFileSync } from "fs"
import { join } from "path"

const PORT = Number(process.env.PORT || 3470)
const PUBLIC_DIR = join(import.meta.dir, "public")

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

function serveStaticFile(filePath: string): Response | null {
  try {
    const fullPath = join(PUBLIC_DIR, filePath)
    if (!fullPath.startsWith(PUBLIC_DIR)) return null
    if (!existsSync(fullPath)) return null

    const content = readFileSync(fullPath)
    const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")).toLowerCase() : ""
    const contentType = MIME_TYPES[ext] || "application/octet-stream"

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return null
  }
}

const server = Bun.serve({
  port: PORT,
  fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveStaticFile("index.html") ?? new Response("Not Found", { status: 404 })
    }

    if (url.pathname === "/styles.css") {
      return serveStaticFile("styles.css") ?? new Response("Not Found", { status: 404 })
    }

    // Allow future static assets under /assets/*
    if (url.pathname.startsWith("/assets/")) {
      return serveStaticFile(url.pathname.slice(1)) ?? new Response("Not Found", { status: 404 })
    }

    // Simple JSON health/info
    if (url.pathname === "/api/info") {
      return Response.json({
        name: "Order QR Receipt Site",
        port: PORT,
        url: `http://localhost:${PORT}`,
        format: "#p=base64url(JSON)",
      })
    }

    return new Response("Not Found", { status: 404 })
  },
})

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                        Order QR Receipt Site                                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  HTTP Server:    http://localhost:${PORT}                                        ║
║  Receipt URL:    http://localhost:${PORT}/#p=...                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)

export { server }

