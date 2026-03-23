const fs = require("fs");
const path = require("path");

function defaultPayload() {
  return [
    {
      role: "agent",
      message: "Hi, I am Liz calling from Wendy's Pizzas. May I know your name?",
    },
    { role: "user", message: "Sudhath." },
    {
      role: "agent",
      message: "Nice to meet you, Sudhath. Would you like to place an order, reserve a table, or neither?",
    },
    { role: "user", message: "Uh, both." },
    { role: "agent", message: "Great, Sudhath, what would you like to order?" },
    { role: "user", message: "One cheeseburger, one Coke and one fries." },
    {
      role: "agent",
      message:
        "So, that's one cheeseburger, one Coke, and one fries for you, Sudhath. Would you also like to reserve a table?",
    },
    { role: "user", message: "Yes." },
    { role: "agent", message: "Sure, Sudhath, for how many people?" },
    { role: "user", message: "Two people." },
    { role: "agent", message: "And what time would you like the reservation, Sudhath?" },
    { role: "user", message: "March twenty-fifth at eight PM." },
  ];
}

function loadPayloadFromArg() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    return defaultPayload();
  }

  const absolutePath = path.isAbsolute(payloadPath)
    ? payloadPath
    : path.join(process.cwd(), payloadPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(raw);
}

async function main() {
  const webhookUrl =
    process.env.WEBHOOK_URL || "http://localhost:3000/webhook/elevenlabs";
  const payload = loadPayloadFromArg();

  console.log(`Sending payload to ${webhookUrl}`);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  console.log(`Status: ${response.status}`);
  console.log(`Body: ${text}`);
  console.log("Check server logs for line-by-line extracted fields.");
}

main().catch((error) => {
  console.error("Test payload failed:", error.message);
  process.exit(1);
});
