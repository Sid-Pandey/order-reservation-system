require("dotenv").config();

const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
app.use(express.json());

const db = new sqlite3.Database(path.join(__dirname, "data.db"));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ lastID: this.lastID });
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS call_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caller_name TEXT,
      order_text TEXT,
      reservation_date TEXT,
      reservation_time TEXT,
      number_of_people INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getConversationTurns(payload) {
  const candidates = [
    payload,
    payload?.data?.transcript,
    payload?.transcript,
    payload?.data?.conversation,
    payload?.conversation,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const historyRaw =
    payload?.data?.conversation_initiation_client_data?.dynamic_variables?.system__conversation_history;
  if (typeof historyRaw === "string") {
    try {
      const parsed = JSON.parse(historyRaw);
      if (Array.isArray(parsed?.entries)) {
        return parsed.entries;
      }
    } catch {
      // Ignore malformed history JSON and continue with empty turns.
    }
  }

  return [];
}

function buildConversationText(payload) {
  const turns = getConversationTurns(payload);
  return turns
    .filter((turn) => turn?.message)
    .map((turn) => {
      const role = String(turn?.role || "unknown").toUpperCase();
      return `${role}: ${String(turn.message).trim()}`;
    })
    .join("\n");
}

function buildAnalysisContext(payload) {
  const analysis = payload?.data?.analysis ?? payload?.analysis;
  if (!analysis) {
    return "";
  }

  const lines = [];
  if (analysis.transcript_summary) {
    lines.push(`TRANSCRIPT_SUMMARY: ${analysis.transcript_summary}`);
  }

  const dataResults =
    analysis.data_collection_results_list ??
    Object.values(analysis.data_collection_results ?? {});

  if (Array.isArray(dataResults) && dataResults.length > 0) {
    lines.push("DATA_COLLECTION_RESULTS:");
    for (const item of dataResults) {
      if (item?.data_collection_id) {
        lines.push(`- ${item.data_collection_id}: ${JSON.stringify(item.value ?? null)}`);
      }
    }
  }

  return lines.join("\n");
}

function buildLlmInput(payload) {
  const summary =
    payload?.data?.analysis?.transcript_summary ??
    payload?.analysis?.transcript_summary;

  if (summary) {
    return [
      "Use the following transcript summary to extract structured fields.",
      "",
      `TRANSCRIPT_SUMMARY: ${summary}`,
    ].join("\n");
  }

  const conversation = buildConversationText(payload);
  return conversation || "No conversation lines found.";
}

function parseNumberOfPeople(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTextValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeOrderValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeTextValue(item))
      .filter(Boolean)
      .join(", ");
  }

  if (value && typeof value === "object") {
    if (Array.isArray(value.items)) {
      return value.items
        .map((item) => normalizeTextValue(item))
        .filter(Boolean)
        .join(", ");
    }
  }

  return normalizeTextValue(value);
}

async function extractWithLlm(conversationText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.EXTRACTION_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract the following fields from this restaurant call conversation and return ONLY valid JSON with these exact keys: callerName, order, reservationDate, reservationTime, numberOfPeople. Use null if unknown.",
        },
        {
          role: "user",
          content: conversationText,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${errorBody}`);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty content");
  }

  const parsed = JSON.parse(content);
  return {
    callerName: normalizeTextValue(parsed.callerName),
    order: normalizeOrderValue(parsed.order),
    reservationDate: normalizeTextValue(parsed.reservationDate),
    reservationTime: normalizeTextValue(parsed.reservationTime),
    numberOfPeople: parseNumberOfPeople(parsed.numberOfPeople),
  };
}

async function saveRecord(record) {
  const result = await run(
    `
      INSERT INTO call_records (
        caller_name,
        order_text,
        reservation_date,
        reservation_time,
        number_of_people
      ) VALUES (?, ?, ?, ?, ?)
    `,
    [
      record.callerName,
      record.order,
      record.reservationDate,
      record.reservationTime,
      Number.isInteger(record.numberOfPeople) ? record.numberOfPeople : null,
    ]
  );

  return result.lastID;
}

function printExtractionLineByLine(record) {
  console.log("Extracted fields (line by line):");
  console.log(`- callerName: ${record.callerName ?? "null"}`);
  console.log(`- order: ${record.order ?? "null"}`);
  console.log(`- reservationDate: ${record.reservationDate ?? "null"}`);
  console.log(`- reservationTime: ${record.reservationTime ?? "null"}`);
  console.log(`- numberOfPeople: ${record.numberOfPeople ?? "null"}`);
}

// 🔥 Webhook endpoint
app.post("/webhook/elevenlabs", (req, res) => {
  console.log("🔥 The latest Webhook received:");
  console.log(JSON.stringify(req.body, null, 2));

  // IMPORTANT: respond immediately
  res.status(200).send("ok");

  // async processing
  setTimeout(() => {
    processWebhook(req.body).catch((error) => {
      console.error("Webhook processing failed:", error.message);
    });
  }, 0);
});

app.get("/records", async (req, res) => {
  try {
    const rows = await all("SELECT * FROM call_records ORDER BY id DESC");
    res.json(rows);
  } catch (error) {
    console.error("Failed to fetch records:", error.message);
    res.status(500).json({ error: "Failed to fetch records" });
  }
});

async function processWebhook(data) {
  console.log("Processing webhook...");
  const conversationText = buildLlmInput(data);
  console.log("LLM input built");
  const extracted = await extractWithLlm(conversationText);
  printExtractionLineByLine(extracted);
  const recordId = await saveRecord(extracted);
  console.log(`Saved record id: ${recordId}`);
}

// health check
app.get("/", (req, res) => {
  res.send("Server running 🚀");
});

const PORT = process.env.PORT || 3000;
initDatabase()
  .then(() => {
    console.log("Database initialized");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error.message);
    process.exit(1);
  });