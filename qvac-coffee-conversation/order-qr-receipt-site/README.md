## Order QR Receipt Site (client-only)

### What this is
- A tiny Bun static server that renders a **pretty receipt page**.
- The receipt data is **encoded in the URL hash** as `#p=...` (base64url JSON).
- No API calls; no database; no server-side lookup.

### Run it locally

```bash
cd order-qr-receipt-site
bun run dev
```

Defaults to `http://localhost:3470` (override with `PORT=XXXX`).

### URL format
- Receipt URL:
  - `http://localhost:3470/#p=ENCODED_PAYLOAD`
- `ENCODED_PAYLOAD` is base64url of UTF-8 JSON.

### Payload (v1)

```json
{
  "v": 1,
  "orderId": "ORD-2026-0001",
  "customerName": "Omar",
  "timestamp": "2026-01-14T12:34:56.000Z",
  "currency": "USDT",
  "total": 8.9,
  "items": [{"drink":"latte","size":"large","extras":["oat milk"]}],
  "tx": {"hash":"0x...", "explorerUrl":"https://..."}
}
```

---

## Deploy on a VPS with Coolify (Dockerfile)

This site is static (client-only). The recommended production deployment is an **Nginx container** that serves `public/`.

### 1) Add a Dockerfile (recommended: Nginx)
Create a `Dockerfile` in the repo root:

```dockerfile
FROM nginx:alpine

# Copy static site
COPY public/ /usr/share/nginx/html/

# (Optional) If you add an nginx.conf, uncomment:
# COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
```

(Optional) add a `.dockerignore`:

```gitignore
node_modules
*.log
.DS_Store
```

### 2) Push the repo somewhere Coolify can access
- Push this directory to GitHub/GitLab (recommended), or use whatever git source your Coolify instance supports.

### 3) Create the application in Coolify
- **New Application** → select your Git repo
- **Build type**: Dockerfile
- **Port**: `80`
- **Domain**: e.g. `receipt.example.com`
- Enable **HTTPS/TLS** in Coolify for the domain
- Deploy

If you're deploying from a monorepo, set the application's **base directory** to the receipt site folder (so Coolify finds the Dockerfile + `public/`).

### 4) Point the coffee assistant at the deployed URL
Set the coffee assistant environment variable:

```bash
ORDER_QR_RECEIPT_BASE_URL=https://receipt.example.com
```

This makes newly generated QR codes open the deployed receipt viewer.

### 5) Quick verification
Open:

- `https://receipt.example.com/`

Then click the **"Open example receipt"** button, or scan a freshly generated QR code and confirm it renders the receipt.
