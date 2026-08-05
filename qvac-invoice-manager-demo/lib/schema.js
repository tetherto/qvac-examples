// Turns a user-defined template into a strict JSON Schema for the SDK's
// `responseFormat: { type: "json_schema" }`, and back into typed table cells.
//
// This is the whole point of the app: the user decides which columns their accounting table
// has, and that choice becomes the grammar the model is forced to emit. Because llama.cpp
// constrains generation to the schema, the output is guaranteed to have exactly the fields
// the template asked for, in the right JSON types. No parsing of prose, no missing keys.
"use strict";

const FIELD_TYPES = {
  text:     { json: { type: "string" },  hint: "text as printed" },
  number:   { json: { type: "number" },  hint: "a plain number, no thousand separators, dot as decimal mark" },
  date:     { json: { type: "string" },  hint: "a date in YYYY-MM-DD format" },
  currency: { json: { type: "string" },  hint: "a 3-letter ISO currency code such as EUR, USD, CHF" },
};

// The token the model is told to emit when a field is simply not on the document. Anything a model
// might reach for instead is folded in below, because they all mean the same thing and all of them
// must end up flagged rather than stored as data.
const NOT_STATED = "N/A";
const NOT_STATED_RE = /^(n\/?a|none|null|nil|unknown|not stated|not found|not specified|not available|not applicable|-{1,3}|\?+)$/i;

function slug(label) {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field";
}

// Ensure every field has a stable, unique key. The key is what the model emits and what the
// CSV header uses, so it must not change when a label is renamed after extraction.
function normaliseFields(fields) {
  const seen = new Set();
  return (fields || []).map((f, i) => {
    let key = f.key || slug(f.label);
    while (seen.has(key)) key = `${key}_${i}`;
    seen.add(key);
    return {
      key,
      label: f.label || key,
      type: FIELD_TYPES[f.type] ? f.type : "text",
      description: f.description || "",
      required: f.required !== false,
    };
  });
}

// Build the JSON Schema. Every field is required and additionalProperties is false: a partially
// filled object is worse than a wrong one here, because a silently missing column looks like a
// clean row in a ledger. When the model cannot find a value it must still emit the key, and the
// prompt tells it to use an empty string or 0, which the UI then flags for review.
function schemaForTemplate(template) {
  const fields = normaliseFields(template.fields);
  const properties = {};
  for (const f of fields) {
    const base = { ...FIELD_TYPES[f.type].json };
    const desc = [f.label, f.description, FIELD_TYPES[f.type].hint].filter(Boolean).join(" - ");
    properties[f.key] = { ...base, description: desc };
  }
  return {
    name: slug(template.name) || "record",
    schema: {
      type: "object",
      properties,
      required: fields.map((f) => f.key),
      additionalProperties: false,
    },
    fields,
  };
}

// The instruction block that accompanies the schema. The schema pins the SHAPE; this pins the
// SEMANTICS, which a grammar cannot express. Net versus total is the classic accounting trap: both
// are plausible numbers of the right type, so nothing downstream can tell them apart. Hence the
// explicit rule below, and the arithmetic check in checkArithmetic() as the backstop.
function promptForTemplate(template) {
  const fields = normaliseFields(template.fields);
  const lines = fields.map((f) => {
    const t = FIELD_TYPES[f.type].hint;
    return `- ${f.key}: ${f.label}${f.description ? ` (${f.description})` : ""}. Format: ${t}.`;
  });
  return [
    "Extract these fields from the document:",
    ...lines,
    "",
    "Rules:",
    "- Report only what the document actually states. Never invent or compute a value that is not printed.",
    "- Distinguish the net amount (before tax) from the tax amount and from the total due. Do not put the total in a net field.",
    // The sentinel is the important part. Measured on 102 real Anthropic invoices, which carry no VAT
    // registration number at all: asked for an "empty string" when a field is absent, the model
    // filled the VAT ID column with the nearest plausible text instead, every single time. It
    // produced "Cyprus", "Cyprus 19% on $10.08", "Anthropic, PBC" and even "4477" (a fragment of a
    // PO box). All 102 rows were wrong and none was flagged, because a non-empty string looks like a
    // successful read. A required string field pushes a model to fill it; an explicit token it is
    // told to emit is far easier to produce than nothing, and trivially detected afterwards.
    `- If the document does not state a value for a field, output exactly ${NOT_STATED} for that field. Use 0 for a number that is not stated.`,
    `- Never substitute a value from a nearby line. A country, a city, a tax rate, an address, a phone number or the supplier's own name is NOT a registration number, an invoice number or a date. If you cannot find the real value, ${NOT_STATED} is the correct answer.`,
    // KNOWN LIMITATION, and this line does NOT fix it. A B2B invoice normally prints both parties'
    // VAT numbers. Given a US supplier with no VAT number of its own and the customer's number under
    // "Bill to", Qwen3 4B reports the CUSTOMER's number as the supplier's, and it survives every
    // plausibility check because it is a perfectly well-formed VAT number.
    //
    // Measured on 4 such documents, three separate levers, all 4/4 wrong every time: this rule in
    // the prompt, an explicit negative in the field description, and renaming the column to
    // "Supplier VAT ID". The model takes the only VAT number on the page regardless of what it is
    // told. The rule is kept because it states the intent and may hold on a larger model, but do
    // not rely on it: on a two-party document, treat an identifier column as needing review.
    `- The document has two parties. Every field describes the SUPPLIER, the party issuing the document, unless the column says otherwise. Ignore the "Bill to", "Customer", "Ship to" or "Client" block entirely: its name, address and registration numbers are never the answer. If only the customer has a registration number, the supplier's is ${NOT_STATED}.`,
    "- A receipt records a payment that already happened, so it has no due date. Do not copy the paid date into a due date field.",
    "- Amounts are plain numbers: no currency symbols, no thousand separators, a dot for decimals.",
  ].join("\n");
}

// Parse an amount the way it is actually printed on invoices, which is NOT always "1234.56".
//
// The naive version of this function was `Number(s.replace(/[^0-9.-]/g, ""))`, and it was the worst
// bug in the app: it strips the comma, so a French invoice reading "2 690,00" became 269000. A
// hundredfold error, entered in a ledger, with nothing flagged. Measured before the fix:
//   "2690,00" -> 269000     "8,1" -> 81      "2.690,00" -> 2.69     "1.234" -> 1.234
//
// The rule here: the LAST separator is the decimal mark, everything else is grouping. When that
// cannot be decided (a lone separator with exactly 3 digits after it, where "1.234" is 1234 to a
// German and 1.234 to an American), the value is reported as NOT ok so it gets flagged for a human
// instead of being silently guessed. In a ledger a flagged cell costs a glance; a wrong number
// costs a filing.
function parseAmount(raw) {
  if (typeof raw === "number") return { value: raw, ok: Number.isFinite(raw) };
  let s = String(raw ?? "").trim();
  if (s === "") return { value: 0, ok: false };

  // Accounting notation: (1.234,56) means negative. Also handles a leading or trailing minus.
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s) || /-$/.test(s)) negative = true;

  // Drop currency symbols, letters, spaces and the sign; keep only digits and separators.
  s = s.replace(/[^0-9.,]/g, "");
  if (s === "") return { value: 0, ok: false };

  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  let intPart = s, decPart = "";

  if (dots && commas) {
    // Both present: whichever comes last is the decimal mark.
    const decSep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const at = s.lastIndexOf(decSep);
    intPart = s.slice(0, at);
    decPart = s.slice(at + 1);
  } else if (dots || commas) {
    const sep = dots ? "." : ",";
    const count = dots || commas;
    const at = s.lastIndexOf(sep);
    const after = s.length - at - 1;
    if (count > 1) {
      // Repeated separator can only be grouping: 1.234.567
      intPart = s;
    } else if (after === 3) {
      // Genuinely ambiguous: 1.234 is 1234 or 1.234 depending on where you live. Refuse to guess.
      return { value: 0, ok: false, ambiguous: true };
    } else if (after === 0) {
      intPart = s.slice(0, at);   // a trailing separator, "1234."
    } else {
      intPart = s.slice(0, at);
      decPart = s.slice(at + 1);
    }
  }

  intPart = intPart.replace(/[.,]/g, "");
  if (intPart === "" && decPart === "") return { value: 0, ok: false };
  const n = Number(`${intPart || "0"}.${decPart || "0"}`);
  if (!Number.isFinite(n)) return { value: 0, ok: false };
  return { value: negative ? -n : n, ok: true };
}

// A value can be the right TYPE and still be obvious nonsense. Returns a short reason, or null.
//
// This exists because of a measured failure: every one of 102 real invoices came back with a VAT ID
// that was not a VAT ID ("Cyprus", "Anthropic, PBC", "4477"), and nothing flagged it, because the
// only question being asked was "is this string non-empty?". These checks ask the cheap follow-up
// question a bookkeeper would ask at a glance.
const ID_LABEL_RE = /vat|tax|registration|siret|siren|iban|bic|swift|reg\b|number|no\.|ref/i;

function implausible(field, value) {
  const s = String(value ?? "").trim();
  if (s === "") return null;                     // absence is handled by `empty`, not here

  if (field.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return `not a YYYY-MM-DD date: "${s}"`;
    const [y, m, d] = s.split("-").map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return `not a real date: "${s}"`;
    return null;
  }

  if (field.type === "currency") {
    // "Cyprus" is a country, not a currency. A 3-letter ISO code is the whole contract here.
    if (!/^[A-Za-z]{3}$/.test(s)) return `not a 3-letter currency code: "${s}"`;
    return null;
  }

  if (field.type === "text" && ID_LABEL_RE.test(`${field.label} ${field.key}`)) {
    // An identifier without a single digit is a label, a country or a company name that leaked in.
    if (!/\d/.test(s)) return `no digits, so this is not an identifier: "${s}"`;
    // A tax LINE copied wholesale instead of a registration number.
    if (/%|\$|€|£/.test(s)) return `looks like a tax or amount line, not an identifier: "${s}"`;
    return null;
  }

  return null;
}

// Coerce a model value into the cell type the table expects, and report whether it looks empty
// so the UI can mark the row as needing a human.
function coerce(field, value) {
  if (field.type === "number") {
    const { value: n, ok } = parseAmount(value);
    // A zero is reported as empty on purpose: the prompt tells the model to return 0 when a field
    // is absent, so 0 and "not found" are indistinguishable and both deserve a look.
    return { value: ok ? n : 0, empty: !ok || n === 0 };
  }
  let s = String(value ?? "").trim();
  // The model was asked to say N/A when a field is not on the document. Honour that as absence
  // rather than storing the literal word in an accounting table.
  if (NOT_STATED_RE.test(s)) s = "";
  const reason = s === "" ? null : implausible(field, s);
  // An implausible value is worse than a missing one, because it looks like data. Blank it and flag.
  return { value: reason ? "" : s, empty: s === "" || !!reason, reason };
}

// net + tax == total is arithmetic, not inference. Checking it costs one line and catches the whole
// family of magnitude errors (x10, x100, /1000, a dropped sign, a total copied into the net field)
// no matter which layer produced them: a bad parse, a model slip, or a typo in a manual correction.
// It only fires when the template actually has all three columns and none of them is zero, so a
// template that does not model tax is unaffected.
function checkArithmetic(fields, values) {
  const find = (re) => fields.find((f) => f.type === "number" && re.test(f.key));
  const net = find(/net|excl|before_tax|taxable|base/);
  const tax = find(/vat_amount|tax_amount|^vat$|^tax$/);
  const total = find(/total|gross|incl|amount_due/);
  if (!net || !tax || !total) return [];
  const n = Number(values[net.key]), t = Number(values[tax.key]), g = Number(values[total.key]);
  if (![n, t, g].every(Number.isFinite)) return [];
  if (n === 0 || g === 0) return [];                       // nothing to check against
  if (Math.abs(n + t - g) <= 0.02) return [];              // allow for rounding on the invoice
  return [{
    keys: [net.key, tax.key, total.key],
    message: `${net.label} + ${tax.label} = ${(n + t).toFixed(2)}, but ${total.label} says ${g.toFixed(2)}`,
  }];
}

const STARTER_TEMPLATES = [
  {
    id: "supplier-invoices",
    name: "Supplier invoices",
    description: "One row per purchase invoice, the columns a bookkeeper needs to post it.",
    fields: [
      { label: "Supplier",       type: "text",     description: "the company issuing the invoice, not the recipient" },
      { label: "Invoice number", type: "text" },
      { label: "Invoice date",   type: "date" },
      { label: "Due date",       type: "date" },
      { label: "VAT ID",         type: "text",     description: "the supplier's tax or VAT registration number" },
      { label: "Currency",       type: "currency" },
      { label: "Net amount",     type: "number",   description: "total before tax" },
      { label: "VAT amount",     type: "number",   description: "the tax amount only" },
      { label: "Total amount",   type: "number",   description: "the final amount due including tax" },
    ],
  },
  {
    id: "vat-return",
    name: "VAT return",
    description: "Just what a VAT filing needs, nothing else.",
    fields: [
      { label: "Supplier",     type: "text" },
      { label: "VAT ID",       type: "text" },
      { label: "Invoice date", type: "date" },
      { label: "Net amount",   type: "number", description: "taxable base, before tax" },
      { label: "VAT rate",     type: "number", description: "the percentage as a number, for example 20 for 20%" },
      { label: "VAT amount",   type: "number" },
    ],
  },
  {
    id: "expenses",
    name: "Expense report",
    description: "Receipts, for reimbursement. Deliberately short.",
    fields: [
      { label: "Merchant",  type: "text" },
      { label: "Date",      type: "date" },
      { label: "Category",  type: "text",     description: "what was bought, in a few words: travel, meals, software, hardware" },
      { label: "Currency",  type: "currency" },
      { label: "Total",     type: "number",   description: "the amount paid" },
    ],
  },
];

module.exports = { FIELD_TYPES, STARTER_TEMPLATES, slug, normaliseFields, schemaForTemplate, promptForTemplate, coerce, parseAmount, checkArithmetic, implausible, NOT_STATED };
