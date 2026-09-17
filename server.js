require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const port = Number(process.env.PORT) || 3000;
const dataDirectory = path.join(__dirname, "data");

app.use(express.json({ limit: "20kb" }));
app.use(express.static(__dirname));

function ensureDataFile(fileName) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const filePath = path.join(dataDirectory, fileName);
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "[]", "utf8");
  return filePath;
}

function appendRecord(fileName, record) {
  const filePath = ensureDataFile(fileName);
  const records = JSON.parse(fs.readFileSync(filePath, "utf8"));
  records.push(record);
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
}

function updateRecord(fileName, predicate, update) {
  const filePath = ensureDataFile(fileName);
  const records = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const index = records.findIndex(predicate);
  if (index === -1) return false;
  records[index] = { ...records[index], ...update };
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
  return true;
}

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeMpesaPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("254") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9 && /^[17]/.test(digits)) return `254${digits}`;
  return "";
}

function mpesaConfigured() {
  return [
    "MPESA_CONSUMER_KEY",
    "MPESA_CONSUMER_SECRET",
    "MPESA_INITIATOR_NAME",
    "MPESA_SECURITY_CREDENTIAL",
    "MPESA_SENDER_SHORTCODE",
    "MPESA_RECEIVER_SHORTCODE",
    "MPESA_QUEUE_TIMEOUT_URL",
    "MPESA_RESULT_URL"
  ].every((name) => process.env[name]);
}

function mpesaBaseUrl() {
  return process.env.MPESA_ENVIRONMENT === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

async function getMpesaToken() {
  const credentials = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString("base64");
  const response = await fetch(`${mpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` }
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error(result.errorMessage || "Could not authenticate with M-Pesa.");
  return result.access_token;
}

async function startMpesaB2BPayment({ amount, accountReference }) {
  const token = await getMpesaToken();
  const response = await fetch(`${mpesaBaseUrl()}/mpesa/b2b/v1/paymentrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      Initiator: process.env.MPESA_INITIATOR_NAME,
      SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
      CommandID: process.env.MPESA_COMMAND_ID || "BusinessPayment",
      SenderIdentifierType: process.env.MPESA_SENDER_IDENTIFIER_TYPE || "4",
      RecieverIdentifierType: process.env.MPESA_RECEIVER_IDENTIFIER_TYPE || "4",
      Amount: Math.round(amount),
      PartyA: process.env.MPESA_SENDER_SHORTCODE,
      PartyB: process.env.MPESA_RECEIVER_SHORTCODE,
      AccountReference: accountReference,
      Remarks: "Church donation",
      QueueTimeOutURL: process.env.MPESA_QUEUE_TIMEOUT_URL,
      ResultURL: process.env.MPESA_RESULT_URL
    })
  });
  const body = await response.text();
  let result;
  try {
    result = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`M-Pesa B2B returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok || (result.ResponseCode && result.ResponseCode !== "0")) {
    throw new Error(result.errorMessage || result.ResponseDescription || result.ResponseDesc || "M-Pesa B2B payment request failed.");
  }
  return result;
}

app.get("/api/health", (request, response) => {
  response.json({ status: "ok", service: "Favour Restoration Word of God Ministries" });
});

app.post("/api/contact", (request, response) => {
  const firstName = text(request.body.firstName, 60);
  const lastName = text(request.body.lastName, 60);
  const email = text(request.body.email, 160).toLowerCase();
  const subject = text(request.body.subject, 80);
  const message = text(request.body.message, 2000);
  const phone = text(request.body.phone, 40);

  if (!firstName || !lastName || !validEmail(email) || !subject || !message) {
    return response.status(400).json({ error: "Please provide all required contact details." });
  }

  appendRecord("contact-submissions.json", {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    firstName,
    lastName,
    email,
    phone,
    subject,
    message
  });

  return response.status(201).json({ message: "Your message has been received. We will get back to you soon." });
});

async function createDonation(request, response) {
  const amount = Number(request.body.amount);
  const method = text(request.body.method, 20).toLowerCase();
  const frequency = text(request.body.frequency, 20).toLowerCase() || "one-time";
  const email = text(request.body.email, 160).toLowerCase();
  const rawPhone = text(request.body.phone, 40);
  const phone = method === "mpesa" ? normalizeMpesaPhone(rawPhone) : rawPhone;

  if (!Number.isFinite(amount) || amount < 10 || amount > 10000000) {
    return response.status(400).json({ error: "Enter a donation amount between KES 10 and KES 10,000,000." });
  }
  if (!["mpesa", "card"].includes(method)) {
    return response.status(400).json({ error: "Choose M-Pesa or card as your payment method." });
  }
  if (!validEmail(email)) {
    return response.status(400).json({ error: "Enter a valid email address." });
  }
  const donation = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    amount,
    currency: "KES",
    method,
    frequency,
    email,
    phone,
    status: "pending"
  };
  appendRecord("donations.json", donation);

  if (method === "mpesa" && !mpesaConfigured()) {
    return response.status(202).json({
      donationId: donation.id,
      status: "pending",
      message: "Donation recorded. Add your B2B Daraja credentials to submit it to Safaricom automatically."
    });
  }

  if (method === "card") {
    return response.status(202).json({
      donationId: donation.id,
      status: "pending",
      message: "Donation recorded. Connect a hosted card provider checkout before accepting card payments."
    });
  }

  try {
    const b2b = await startMpesaB2BPayment({ amount, accountReference: `FRM-${donation.id.slice(0, 8)}` });
    updateRecord("donations.json", (item) => item.id === donation.id, {
      status: "requested",
      conversationId: b2b.ConversationID,
      originatorConversationId: b2b.OriginatorConversationID
    });
    return response.status(202).json({
      donationId: donation.id,
      status: "requested",
      conversationId: b2b.ConversationID,
      message: "Your M-Pesa business payment request has been submitted. The payment status will be updated after Safaricom sends the result."
    });
  } catch (error) {
    updateRecord("donations.json", (item) => item.id === donation.id, { status: "failed", error: error.message });
    return response.status(502).json({ donationId: donation.id, error: error.message });
  }
}

app.post("/api/donations", createDonation);
app.post("/api/payment", async (request, response) => {
  request.body.method = "mpesa";
  request.body.email = text(request.body.email, 160) || "anonymous@favourrestoration.local";
  request.body.frequency = text(request.body.frequency, 20).toLowerCase() || "one-time";
  return createDonation(request, response);
});

app.post("/api/payment/callback", (request, response) => {
  const result = request.body;
  if (!result || (!result.ResultCode && !result.ResultDesc && !result.ConversationID)) {
    return response.status(400).json({ error: "Invalid M-Pesa B2B result callback." });
  }
  updateRecord("donations.json", (item) => item.conversationId === result.ConversationID, {
    status: Number(result.ResultCode) === 0 ? "completed" : "failed",
    resultCode: result.ResultCode,
    resultDescription: result.ResultDesc,
    transactionId: result.TransactionID
  });
  return response.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

app.post("/api/payment/timeout", (request, response) => {
  const result = request.body || {};
  updateRecord("donations.json", (item) => item.conversationId === result.ConversationID, {
    status: "timeout",
    resultCode: result.ResultCode,
    resultDescription: result.ResultDesc || "M-Pesa B2B request timed out."
  });
  return response.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

app.use((error, request, response, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }
  return next(error);
});

app.listen(port, () => {
  console.log(`Favour Restoration backend running at http://localhost:${port}`);
});
