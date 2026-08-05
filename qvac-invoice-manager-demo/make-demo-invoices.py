#!/usr/bin/env python3
"""
Generates a folder of fictional invoices and receipts for testing and for recording a demo.

Nothing here is real. Every company, address, VAT number and amount is invented, and every page
carries a footer saying so. The point is to exercise the app, not to look like anyone's books.

The set is deliberately built to show the app doing something on each feature:

  - nested subfolders            -> the recursive folder scan
  - text PDFs                   -> the fast text path, "text" badge
  - image-only PDFs and photos  -> the Chromium rasterise + vision path, "vision" badge
  - receipts with no due date    -> "not on the document", which is the CORRECT answer
  - a US supplier with no VAT id -> the same, on a different field
  - continental number formats   -> 1.234,56 parsed as 1234.56
  - two broken totals           -> the net + tax = total arithmetic warning
  - a filename containing '#'    -> the pathToFileURL fix
  - a few non-document files     -> skipped quietly by the scan

Usage:  python3 make-demo-invoices.py [output_dir]
Default output: ~/Desktop/QVAC-invoice-demo
"""
import os
import random
import sys
from datetime import date, timedelta

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from PIL import Image, ImageDraw, ImageFont, ImageFilter

random.seed(20260804)  # a fixed set, so a re-run gives the same folder

W, H = A4
FOOTER = "Sample document generated for software testing. Not a real invoice."

# ── fictional suppliers ───────────────────────────────────────────────────────
# `vat` None means the supplier genuinely has no VAT registration number, which is normal for a US
# company. The app should report that as absent rather than inventing one.
SUPPLIERS = [
    dict(name="Northwind Cloud GmbH", addr=["Ritterstrasse 12", "10969 Berlin", "Germany"],
         vat="DE811234567", cur="EUR", rate=19, style="eu", item="Managed hosting, monthly"),
    dict(name="Atelier Belleville SARL", addr=["14 rue des Envierges", "75020 Paris", "France"],
         vat="FR00123456789", cur="EUR", rate=20, style="eu", item="Design retainer"),
    dict(name="Helvetia Data AG", addr=["Bahnhofstrasse 3", "8001 Zurich", "Switzerland"],
         vat="CHE-123.456.789 MWST", cur="CHF", rate=8.1, style="eu", item="Data pipeline support"),
    dict(name="Ravensbourne Print Ltd", addr=["48 Deptford High St", "London SE8 4RT",
         "United Kingdom"], vat="GB123456789", cur="GBP", rate=20, style="us",
         item="Print run, 500 units"),
    dict(name="Cobalt Analytics Inc", addr=["1100 Congress Ave", "Austin, TX 78701",
         "United States"], vat=None, cur="USD", rate=0, style="us",
         item="Analytics seats, monthly"),
    dict(name="Lumen Studio BV", addr=["Keizersgracht 210", "1016 DX Amsterdam",
         "Netherlands"], vat="NL123456789B01", cur="EUR", rate=21, style="eu",
         item="Video production, one edit"),
    dict(name="Pergola Roasters Srl", addr=["Via Fontanella 7", "20121 Milano", "Italy"],
         vat="IT12345678901", cur="EUR", rate=22, style="eu", item="Office coffee supply"),
    dict(name="Kestrel Freight Oy", addr=["Satamakatu 5", "00160 Helsinki", "Finland"],
         vat="FI12345678", cur="EUR", rate=24, style="eu", item="Freight, 2 pallets"),
    dict(name="Sundial Software Kft", addr=["Andrassy ut 66", "1062 Budapest", "Hungary"],
         vat="HU12345676", cur="EUR", rate=27, style="eu", item="Licence, annual"),
    dict(name="Marlowe Legal LLP", addr=["7 Gray's Inn Square", "London WC1R 5JD",
         "United Kingdom"], vat="GB123456789", cur="GBP", rate=20, style="us",
         item="Advisory, 4 hours"),
]

BUYER = ["Blackthorn Studio Ltd", "Unit 4, Herald Works", "Bristol BS1 6QH", "United Kingdom"]

# Deliberately NOT printing the buyer's own VAT number, even though real B2B invoices often do.
#
# Measured on this exact fixture set: with the customer's VAT number on the page, Qwen3 4B puts it in
# the supplier's VAT column on every document that has no supplier VAT of its own, and it survives
# the plausibility check because it is a well-formed VAT number. Three levers were tried (a prompt
# rule, an explicit negative in the field description, renaming the column) and all three failed
# 4/4. Leaving it in would make a demo trip over a limitation the app cannot currently fix. Set this
# to a string if you want to reproduce that failure.
BUYER_VAT = None


def money(v, style):
    """1234.5 -> '1.234,50' on the continent, '1,234.50' elsewhere."""
    s = f"{v:,.2f}"
    if style == "eu":
        s = s.replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return s


def amounts(sup, base):
    net = round(base, 2)
    vat = round(net * sup["rate"] / 100, 2)
    return net, vat, round(net + vat, 2)


# ── the invoice page, drawn once and reused for every output format ───────────
def draw(c, doc):
    sup = doc["sup"]
    st = sup["style"]
    left, right = 22 * mm, W - 22 * mm
    y = H - 26 * mm

    c.setFont("Helvetica-Bold", 19)
    c.drawString(left, y, "RECEIPT" if doc["is_receipt"] else "INVOICE")

    # supplier block, top right
    c.setFont("Helvetica-Bold", 10.5)
    c.drawRightString(right, y + 2, sup["name"])
    c.setFont("Helvetica", 8.5)
    yy = y - 11
    for line in sup["addr"]:
        c.drawRightString(right, yy, line)
        yy -= 10
    if sup["vat"]:
        c.drawRightString(right, yy, f"VAT ID: {sup['vat']}")
        yy -= 10

    # reference block
    y -= 30 * mm
    c.setFont("Helvetica", 9)
    rows = [("Invoice number", doc["number"])]
    if doc["is_receipt"]:
        rows += [("Receipt number", doc["receipt_no"]),
                 ("Date paid", doc["issued"].strftime("%Y-%m-%d"))]
    else:
        rows += [("Date of issue", doc["issued"].strftime("%Y-%m-%d")),
                 ("Date due", doc["due"].strftime("%Y-%m-%d"))]
    for label, value in rows:
        c.setFillGray(0.42)
        c.drawString(left, y, label)
        c.setFillGray(0)
        c.drawString(left + 32 * mm, y, str(value))
        y -= 12

    # buyer
    y -= 10
    c.setFillGray(0.42)
    c.drawString(left, y, "Bill to")
    c.setFillGray(0)
    y -= 12
    c.setFont("Helvetica", 9)
    for line in BUYER:
        c.drawString(left, y, line)
        y -= 10
    if BUYER_VAT:
        c.drawString(left, y, f"VAT ID: {BUYER_VAT}")

    # line items
    y -= 22
    c.setLineWidth(0.6)
    c.line(left, y, right, y)
    y -= 13
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(left, y, "DESCRIPTION")
    c.drawRightString(right - 78, y, "QTY")
    c.drawRightString(right, y, "AMOUNT")
    y -= 6
    c.line(left, y, right, y)

    y -= 15
    c.setFont("Helvetica", 9)
    c.drawString(left, y, sup["item"])
    c.drawRightString(right - 78, y, "1")
    c.drawRightString(right, y, f"{money(doc['net'], st)} {sup['cur']}")

    # totals
    y -= 24
    c.line(right - 78 * mm, y, right, y)
    y -= 14
    label_x, val_x = right - 40 * mm, right
    c.setFont("Helvetica", 9)
    for label, value in [
        ("Subtotal excluding tax", doc["net"]),
        (f"VAT {sup['rate']:g}%" if sup["rate"] else "Tax", doc["vat"]),
    ]:
        c.drawRightString(label_x, y, label)
        c.drawRightString(val_x, y, f"{money(value, st)} {sup['cur']}")
        y -= 13
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(label_x, y, "Amount paid" if doc["is_receipt"] else "Total due")
    c.drawRightString(val_x, y, f"{money(doc['total'], st)} {sup['cur']}")

    if doc["is_receipt"]:
        y -= 22
        c.setFont("Helvetica", 8.5)
        c.setFillGray(0.42)
        c.drawString(left, y, f"Paid by card on {doc['issued'].strftime('%Y-%m-%d')}. "
                              f"No payment is due.")

    # the honest footer
    c.setFont("Helvetica-Oblique", 7)
    c.setFillGray(0.6)
    c.drawString(left, 14 * mm, FOOTER)


def text_pdf(path, doc):
    c = canvas.Canvas(path, pagesize=A4)
    draw(c, doc)
    c.showPage()
    c.save()


# ── the "scanned" variants: an image with no text layer at all ───────────────
def _font(size, bold=False):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
              else "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/System/Library/Fonts/Helvetica.ttc",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def render_image(doc, width=1240):
    """Paint the same invoice as pixels, then rough it up so it looks photographed."""
    sup, st = doc["sup"], doc["sup"]["style"]
    scale = width / 595.0                       # A4 points -> px
    height = int(842 * scale)
    img = Image.new("RGB", (width, height), (252, 251, 248))
    d = ImageDraw.Draw(img)
    f = lambda s, b=False: _font(int(s * scale * 1.34), b)   # noqa: E731
    left, right = int(46 * scale), width - int(46 * scale)
    y = int(60 * scale)

    d.text((left, y), "RECEIPT" if doc["is_receipt"] else "INVOICE", (17, 17, 17), font=f(19, True))
    d.text((left, y), "", (0, 0, 0))
    ry = y
    for i, line in enumerate([sup["name"]] + sup["addr"] +
                             ([f"VAT ID: {sup['vat']}"] if sup["vat"] else [])):
        fo = f(10.5, i == 0)
        d.text((right - d.textlength(line, font=fo), ry), line, (17, 17, 17), font=fo)
        ry += int(15 * scale)

    y += int(90 * scale)
    rows = [("Invoice number", doc["number"])]
    if doc["is_receipt"]:
        rows += [("Receipt number", doc["receipt_no"]),
                 ("Date paid", doc["issued"].strftime("%Y-%m-%d"))]
    else:
        rows += [("Date of issue", doc["issued"].strftime("%Y-%m-%d")),
                 ("Date due", doc["due"].strftime("%Y-%m-%d"))]
    for label, value in rows:
        d.text((left, y), label, (110, 110, 110), font=f(9))
        d.text((left + int(95 * scale), y), str(value), (17, 17, 17), font=f(9))
        y += int(17 * scale)

    y += int(14 * scale)
    d.text((left, y), "Bill to", (110, 110, 110), font=f(9)); y += int(15 * scale)
    for line in BUYER + ([f"VAT ID: {BUYER_VAT}"] if BUYER_VAT else []):
        d.text((left, y), line, (17, 17, 17), font=f(9)); y += int(14 * scale)

    y += int(24 * scale)
    d.line([(left, y), (right, y)], fill=(150, 150, 150), width=1); y += int(18 * scale)
    d.text((left, y), sup["item"], (17, 17, 17), font=f(9))
    amt = f"{money(doc['net'], st)} {sup['cur']}"
    d.text((right - d.textlength(amt, font=f(9)), y), amt, (17, 17, 17), font=f(9))

    y += int(34 * scale)
    for label, value, bold in [
        ("Subtotal excluding tax", doc["net"], False),
        (f"VAT {sup['rate']:g}%" if sup["rate"] else "Tax", doc["vat"], False),
        ("Amount paid" if doc["is_receipt"] else "Total due", doc["total"], True),
    ]:
        fo = f(10 if bold else 9, bold)
        d.text((right - int(230 * scale) - d.textlength(label, font=fo), y), label,
               (17, 17, 17), font=fo)
        v = f"{money(value, st)} {sup['cur']}"
        d.text((right - d.textlength(v, font=fo), y), v, (17, 17, 17), font=fo)
        y += int(17 * scale)

    fo = f(7)
    d.text((left, height - int(40 * scale)), FOOTER, (150, 150, 150), font=fo)

    # Make it look like a scan rather than a screenshot: a slight skew, a grey cast, soft focus.
    img = img.rotate(random.uniform(-0.7, 0.7), resample=Image.BICUBIC, fillcolor=(250, 249, 246))
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    noise = Image.effect_noise((width, height), 12).convert("L")
    img = Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.045)
    return img


def scan_pdf(path, doc):
    """An image-only PDF: no text layer, so the app has to look at it."""
    render_image(doc).convert("RGB").save(path, "PDF", resolution=150)


def photo(path, doc):
    img = render_image(doc, width=1000)
    img.save(path, "JPEG" if path.endswith((".jpg", ".jpeg")) else "PNG", quality=82)


# ── build the set ────────────────────────────────────────────────────────────
def main():
    out = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1
                             else "~/Desktop/QVAC-invoice-demo")
    plan = [
        ("2026/Q1-jan-mar", 12, "invoice", "text"),
        ("2026/Q2-apr-jun", 14, "invoice", "text"),
        ("2026/Q3-jul-sep", 10, "invoice", "text"),
        ("receipts-paid", 11, "receipt", "text"),
        ("scans-and-photos", 5, "invoice", "scan"),
        ("scans-and-photos", 3, "receipt", "photo"),
    ]
    # Two documents whose total does not equal net + tax, so the arithmetic check has something to
    # catch. In a demo this is the moment the app earns its keep.
    broken = {6, 31}
    counter, made, truths = 0, [], []

    for folder, count, kind, fmt in plan:
        d = os.path.join(out, folder)
        os.makedirs(d, exist_ok=True)
        for _ in range(count):
            sup = SUPPLIERS[counter % len(SUPPLIERS)]
            base = round(random.uniform(48, 4200), 2)
            net, vat, total = amounts(sup, base)
            if counter in broken:
                total = round(total * 1.1 + 3, 2)     # plausible, and wrong

            q = {"2026/Q1-jan-mar": 0, "2026/Q2-apr-jun": 1, "2026/Q3-jul-sep": 2}.get(folder, 1)
            issued = date(2026, 1 + q * 3, 1) + timedelta(days=random.randint(0, 82))
            doc = dict(sup=sup, net=net, vat=vat, total=total, issued=issued,
                       due=issued + timedelta(days=random.choice([14, 21, 30])),
                       is_receipt=(kind == "receipt"),
                       number=f"{sup['name'][:3].upper()}-2026-{1000 + counter}",
                       receipt_no=f"{2000 + counter}-{random.randint(1000, 9999)}"
                                  f"-{random.randint(1000, 9999)}")

            stem = (f"Receipt-{doc['receipt_no']}" if kind == "receipt"
                    else f"Invoice-{doc['number']}")
            # One filename with a '#' in it. Perfectly normal on a real invoice, and it used to
            # break the SCANNED path specifically, because that is the one that builds a file:// URL
            # and encodeURI does not escape '#'. So it has to land on a scan to be worth anything:
            # counter 48 is the second image-only PDF.
            if counter == 48:
                stem = "Invoice #2026-0442 (rescan)"

            if fmt == "text":
                p = os.path.join(d, stem + ".pdf"); text_pdf(p, doc)
            elif fmt == "scan":
                p = os.path.join(d, stem + "-scan.pdf"); scan_pdf(p, doc)
            else:
                p = os.path.join(d, stem + "-photo.jpg"); photo(p, doc)
            made.append((p, fmt))
            truths.append((p, doc, fmt))
            counter += 1

    # The ground truth, so accuracy can be measured instead of eyeballed. This is what makes the
    # set a benchmark rather than just a pile of paper.
    import json
    truth = {}
    for p_, doc, fmt_ in truths:
        truth[os.path.relpath(p_, out)] = dict(
            supplier=doc["sup"]["name"],
            invoice_number=doc["number"],
            invoice_date=doc["issued"].strftime("%Y-%m-%d"),
            due_date="" if doc["is_receipt"] else doc["due"].strftime("%Y-%m-%d"),
            vat_id=doc["sup"]["vat"] or "",
            currency=doc["sup"]["cur"],
            net_amount=doc["net"], vat_amount=doc["vat"], total_amount=doc["total"],
            _format=fmt_, _is_receipt=doc["is_receipt"],
        )
    with open(os.path.join(out, "ground-truth.json"), "w") as fh:
        json.dump(truth, fh, indent=1, sort_keys=True)

    # A few files that are not documents, so the folder scan has something to skip quietly.
    with open(os.path.join(out, "notes.txt"), "w") as fh:
        fh.write("Reconciliation notes. Not a document the app should try to read.\n")
    with open(os.path.join(out, "2026", "summary.csv"), "w") as fh:
        fh.write("quarter,total\nQ1,0\nQ2,0\nQ3,0\n")
    os.makedirs(os.path.join(out, "2026", "_archive"), exist_ok=True)
    with open(os.path.join(out, "2026", "_archive", "readme.txt"), "w") as fh:
        fh.write("Empty archive folder, to prove the walk handles it.\n")

    by = {}
    for _, fmt in made:
        by[fmt] = by.get(fmt, 0) + 1
    print(f"\n{len(made)} documents written to {out}\n")
    for folder, count, kind, fmt in plan:
        print(f"  {folder:22} {count:>3} {kind}s as {fmt}")
    print(f"\n  text PDFs (fast path)      {by.get('text', 0)}")
    print(f"  image-only PDFs (vision)   {by.get('scan', 0)}")
    print(f"  photos (vision)            {by.get('photo', 0)}")
    print(f"  plus 3 non-document files the scan should skip")
    print(f"\n  2 invoices have a deliberately wrong total, to trip the arithmetic check")
    print(f"  Cobalt Analytics Inc has no VAT ID, which is correct for a US supplier")
    print(f"  1 filename contains '#'")


if __name__ == "__main__":
    main()
