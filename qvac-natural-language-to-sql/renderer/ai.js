/* ============================================================
   QVAC Natural Language to SQL — natural language → SQL
   In production this runs on QVAC's local Qwen3 4B model, on-device.
   The main process loads the model via @qvac/sdk and exposes it
   through the preload bridge as QVAC_BRIDGE.generateSQL(prompt).
   Only the schema and the question are ever sent — never row data.
   ============================================================ */

window.QVACai = (function () {
  const TODAY = "2026-06-08";

  function schemaToText(schema) {
    return schema
      .map((t) => {
        const cols = t.columns.map((c) => `  ${c.name} ${c.type}`).join("\n");
        return `TABLE ${t.table}(\n${cols}\n)`;
      })
      .join("\n");
  }

  function buildPrompt(schema, question) {
    return `/no_think
You are a SQLite expert. Given the schema and question, write a single SELECT query. Today=${TODAY}.

Schema:
${schemaToText(schema)}

Question: ${question}

Reply with ONLY valid JSON (no markdown, no extra text):
{"sql":"<SELECT query>","explanation":"<one sentence in plain English>"}`;
  }

  function formatSQL(raw) {
    if (!raw) return raw;
    // Collapse all whitespace to single spaces
    let s = raw.replace(/\s+/g, ' ').trim();
    // Break before major clause keywords (longer patterns first to prevent partial matches)
    s = s.replace(
      /\b((?:LEFT|RIGHT|FULL|INNER|CROSS)\s+(?:OUTER\s+)?JOIN|ORDER\s+BY|GROUP\s+BY|UNION\s+ALL|FROM|WHERE|JOIN|ON|HAVING|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT)\b/gi,
      '\n$1'
    );
    // Indent AND / OR so conditions stay readable
    s = s.replace(/\b(AND|OR)\b/gi, '\n  $1');
    return s.replace(/^\n+/, '');
  }

  function parseModelJSON(raw) {
    if (!raw) throw new Error("Empty response from the model.");
    let text = String(raw).trim();
    // Strip <think>...</think> blocks (Qwen3 reasoning mode)
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    // Strip markdown fences
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("Could not find a JSON object in the model response.");
    }
    const slice = text.slice(start, end + 1);
    let obj;
    try {
      obj = JSON.parse(slice);
    } catch (e) {
      throw new Error("The model returned malformed JSON. Try rephrasing.");
    }
    if (!obj.sql || typeof obj.sql !== "string") {
      throw new Error("The model response did not include a SQL query.");
    }
    return {
      sql: formatSQL(obj.sql.trim()),
      explanation: (obj.explanation || "").trim(),
    };
  }

  async function generate(schema, question) {
    const prompt = buildPrompt(schema, question);

    // Local QVAC model via IPC bridge (Electron main process). On-device only.
    if (window.QVAC_BRIDGE && window.QVAC_BRIDGE.generateSQL) {
      const raw = await window.QVAC_BRIDGE.generateSQL(prompt);
      return parseModelJSON(raw);
    }

    throw new Error("No local model available in this environment.");
  }

  return { generate, buildPrompt, parseModelJSON, schemaToText };
})();
