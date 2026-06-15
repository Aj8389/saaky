// Test script: probe which field name the Deriv Trading API v1 accepts for the instrument
const WebSocket = require("ws");

const TOKEN = "ory_at_izmx_O4ujzwOcq3rg01jcuNMpbljgy0OYOoJzQVBvWQ.9XP7YlzUhTZh-PyUPPbHzIwjn_AkPSOj1qhQoyyXdSw";
const API_BASE = "https://api.derivws.com";

const FIELD_NAMES_TO_TRY = [
  "symbol",
  "underlying",
  "instrument_id",
  "instrument",
  "product_id",
  "market",
  "asset",
];

let reqId = 1;
let ws;
let fieldIndex = 0;
let waitTimer;

async function getAccounts() {
  const res = await fetch(`${API_BASE}/trading/v1/options/accounts`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const data = await res.json();
  console.log("Accounts response:", JSON.stringify(data).slice(0, 300));
  const accounts = Array.isArray(data) ? data : (data.data || data.accounts || []);
  return accounts;
}

async function getOtp(accountId) {
  const res = await fetch(`${API_BASE}/trading/v1/options/accounts/${accountId}/otp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  });
  const data = await res.json();
  const url = data.data?.url || data.data?.ws_url || data.ws_url;
  return url;
}

function sendProposal(fieldName) {
  const msg = {
    proposal: 1,
    contract_type: "CALL",
    duration: 1,
    duration_unit: "m",
    basis: "stake",
    amount: 0.5,
    currency: "USD",
    req_id: reqId++,
  };
  msg[fieldName] = "R_100";
  console.log(`\n>>> Testing field: "${fieldName}"`);
  console.log("Sending:", JSON.stringify(msg));
  ws.send(JSON.stringify(msg));
}

function tryNextField() {
  if (fieldIndex >= FIELD_NAMES_TO_TRY.length) {
    console.log("\n=== All field names tested. Closing. ===");
    ws.close();
    return;
  }
  const field = FIELD_NAMES_TO_TRY[fieldIndex++];
  sendProposal(field);
  waitTimer = setTimeout(tryNextField, 3000);
}

async function main() {
  console.log("Fetching accounts...");
  const accounts = await getAccounts();
  if (!accounts.length) { console.error("No accounts"); process.exit(1); }

  const account = accounts.find(a => a.account_type === "real" || a.type === "real") || accounts[0];
  const accountId = account.account_id || account.id || account.loginid;
  console.log("Using account:", accountId);

  console.log("Getting OTP...");
  const wsUrl = await getOtp(accountId);
  console.log("WebSocket URL:", wsUrl);

  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("WebSocket connected. Subscribing to balance first...");
    ws.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: reqId++ }));
    // Wait for balance response then start testing proposals
    setTimeout(tryNextField, 2000);
  });

  ws.on("message", (raw) => {
    const data = JSON.parse(raw.toString());
    if (data.msg_type === "balance") {
      console.log(`Balance: ${data.balance?.balance} ${data.balance?.currency}`);
      return;
    }
    if (data.error) {
      console.log(`<<< ERROR [${data.error.code}]: ${data.error.message}`);
      // Continue to next field immediately
      clearTimeout(waitTimer);
      tryNextField();
      return;
    }
    if (data.msg_type === "proposal") {
      console.log(`<<< SUCCESS! Proposal received for field "${FIELD_NAMES_TO_TRY[fieldIndex - 1]}"`);
      console.log("Proposal:", JSON.stringify(data.proposal).slice(0, 200));
      clearTimeout(waitTimer);
      ws.close();
      return;
    }
    // Log other messages
    console.log(`<<< msg_type=${data.msg_type}:`, JSON.stringify(data).slice(0, 150));
  });

  ws.on("close", () => console.log("WebSocket closed."));
  ws.on("error", (e) => console.error("WS error:", e.message));
}

main().catch(console.error);
