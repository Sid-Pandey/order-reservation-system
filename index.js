require("dotenv").config();

const cors = require("cors");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim())
  : ["http://localhost:3001"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? {
        rejectUnauthorized: false,
      }
    : undefined,
});

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing");
  }

  await query(`
    CREATE TABLE IF NOT EXISTS call_records (
      id BIGSERIAL PRIMARY KEY,
      caller_name TEXT,
      order_text TEXT,
      reservation_date TEXT,
      reservation_time TEXT,
      number_of_people INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
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
  const rows = await query(
    `
      INSERT INTO call_records (
        caller_name,
        order_text,
        reservation_date,
        reservation_time,
        number_of_people
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `,
    [
      record.callerName,
      record.order,
      record.reservationDate,
      record.reservationTime,
      Number.isInteger(record.numberOfPeople) ? record.numberOfPeople : null,
    ]
  );

  return rows?.[0]?.id;
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
    const rows = await query("SELECT * FROM call_records ORDER BY id DESC");
    res.json(rows);
  } catch (error) {
    console.error("Failed to fetch records:", error.message);
    res.status(500).json({ error: "Failed to fetch records" });
  }
});

app.get("/metrics", async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        COUNT(*) AS "totalCalls",
        COALESCE(SUM(CASE WHEN reservation_date IS NOT NULL OR reservation_time IS NOT NULL THEN 1 ELSE 0 END), 0) AS "totalReservations",
        COALESCE(SUM(CASE WHEN order_text IS NOT NULL THEN 1 ELSE 0 END), 0) AS "totalOrders",
        COALESCE(AVG(number_of_people), 0) AS "avgPartySize"
      FROM call_records
    `);

    const metricRow = rows?.[0] ?? {};
    res.json({
      totalCalls: Number(metricRow.totalCalls ?? 0),
      totalReservations: Number(metricRow.totalReservations ?? 0),
      totalOrders: Number(metricRow.totalOrders ?? 0),
      avgPartySize: Number(metricRow.avgPartySize ?? 0),
    });
  } catch (error) {
    console.error("Failed to fetch metrics:", error.message);
    res.status(500).json({ error: "Failed to fetch metrics" });
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

app.get("/healthz", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
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