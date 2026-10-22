#!/usr/bin/env node
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const file = args.find((arg) => !arg.startsWith("--")) || ".env.production";
const errors = [];
const warnings = [];

function parse(source) {
  const values = new Map();
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    const line = original.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) {
      errors.push(`Line ${index + 1} is not a KEY=value setting.`);
      continue;
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function required(values, key) {
  if (!values.get(key)) errors.push(`${key} is required.`);
}

function httpsUrl(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") errors.push(`${label} must use HTTPS.`);
    if (["localhost", "127.0.0.1"].includes(parsed.hostname))
      errors.push(`${label} cannot point to a local address.`);
    return parsed;
  } catch {
    errors.push(`${label} is not a valid URL.`);
    return null;
  }
}

let values;
try {
  values = parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`Preflight could not read ${file}: ${error.message}`);
  process.exit(1);
}

required(values, "DATABASE_URL");
required(values, "PUBLIC_APP_URL");
if (!values.get("WEB_ORIGINS") && !values.get("WEB_ORIGIN"))
  errors.push("WEB_ORIGINS or WEB_ORIGIN is required.");

const database = values.get("DATABASE_URL") || "";
if (!/^postgres(ql)?:\/\//.test(database))
  errors.push("DATABASE_URL must be a PostgreSQL URL.");
if (/postgres:\/\/noma:noma@/.test(database))
  errors.push(
    "DATABASE_URL still uses the documented development credentials.",
  );

const appUrl = values.get("PUBLIC_APP_URL")
  ? httpsUrl(values.get("PUBLIC_APP_URL"), "PUBLIC_APP_URL")
  : null;
const origins = (values.get("WEB_ORIGINS") || values.get("WEB_ORIGIN") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
for (const origin of origins) httpsUrl(origin, `Web origin ${origin}`);
if (appUrl && !origins.includes(appUrl.origin))
  errors.push("PUBLIC_APP_URL must match one of the configured web origins.");

const cloudinary = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_UPLOAD_PRESET",
];
const configuredCloudinary = cloudinary.filter((key) => values.get(key));
if (
  configuredCloudinary.length &&
  configuredCloudinary.length !== cloudinary.length
)
  errors.push(
    "Cloudinary is partially configured; provide all four Cloudinary settings.",
  );
if (!configuredCloudinary.length)
  warnings.push(
    "Cloudinary is not configured; direct photo and video uploads will be unavailable.",
  );

if (!values.get("GOOGLE_CLIENT_ID"))
  warnings.push("Google sign-in is not configured.");

const resend = values.get("RESEND_API_KEY");
const sender = values.get("EMAIL_FROM") || "";
if (resend && !sender)
  errors.push("EMAIL_FROM is required when Resend is configured.");
if (resend && sender.includes("onboarding@resend.dev"))
  warnings.push(
    "EMAIL_FROM still uses Resend's testing sender and cannot email arbitrary users.",
  );
if (!resend)
  warnings.push(
    "Resend is not configured; verification and recovery email delivery will be unavailable.",
  );

if (!values.get("PAYSTACK_SECRET_KEY"))
  warnings.push(
    "Paystack is not configured; paid plans and listing promotion will be unavailable.",
  );

if (values.get("COOKIE_SECURE") && values.get("COOKIE_SECURE") !== "true")
  errors.push("COOKIE_SECURE must be true for production.");

console.log(`NOMA production preflight: ${file}`);
for (const message of errors) console.error(`ERROR: ${message}`);
for (const message of warnings) console.warn(`WARNING: ${message}`);
if (!errors.length && (!strict || !warnings.length)) {
  console.log(
    warnings.length
      ? `Core configuration passed with ${warnings.length} warning(s).`
      : "All production configuration checks passed.",
  );
  process.exit(0);
}
process.exit(1);
