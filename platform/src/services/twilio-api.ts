// Twilio SMS service — send/receive SMS via Twilio REST API.
// Follows toggl-api.ts pattern: env var validation, error handling.

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid) throw new Error("TWILIO_ACCOUNT_SID environment variable is not set");
  if (!authToken) throw new Error("TWILIO_AUTH_TOKEN environment variable is not set");
  if (!phoneNumber) throw new Error("TWILIO_PHONE_NUMBER environment variable is not set");

  return { accountSid, authToken, phoneNumber };
}

export async function sendSms(
  to: string,
  body: string
): Promise<{ sid: string; status: string }> {
  if (!E164_REGEX.test(to)) {
    throw new Error(`Invalid phone number format. Must be E.164 (e.g., +12025551234)`);
  }

  const { accountSid, authToken, phoneNumber } = getTwilioConfig();

  const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({
    To: to,
    From: phoneNumber,
    Body: body,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return { sid: data.sid, status: data.status };
}

export function validateTwilioSignature(
  signature: string,
  url: string,
  params: Record<string, string>,
  authToken: string
): boolean {
  // Twilio signature validation using HMAC-SHA1
  // Build the data string: URL + sorted params
  const crypto = require("crypto");
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  const computed = crypto
    .createHmac("sha1", authToken)
    .update(data)
    .digest("base64");
  return computed === signature;
}

export { E164_REGEX };
