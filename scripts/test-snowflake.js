const fs = require('node:fs');
const path = require('node:path');
const forge = require('node-forge');

// ── CORRECT CREDENTIALS ──────────────────────────────────────────
const ACCOUNT = 'OVB92403';
const FINGERPRINT = 'SHA256:mABEmpUTSAGKgGZ/GYd6lyeVX4SJNZjtDpFEJ3pE7Bc=';
const USERNAME = 'ATTENDANCE_API_USER';               // uppercase
const WAREHOUSE = 'xs_attendance_api_wh';
const DATABASE = 'ATTENDANCE_DB';
const SCHEMA = 'CORE';

const PRIVATE_KEY_PATH = process.env.SNOWFLAKE_PRIVATE_KEY_PATH || path.resolve(__dirname, '..', 'rsa_key.p8');

if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  throw new Error(`Missing private key file at ${PRIVATE_KEY_PATH}`);
}

const PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function generateJWT() {
  const now = Math.floor(Date.now() / 1000);

  // Exact format Snowflake requires:
  const issuer = `${ACCOUNT}.${USERNAME}.${FINGERPRINT}`;
  const subject = `${ACCOUNT}.${USERNAME}`;

  const payload = { iss: issuer, sub: subject, iat: now, exp: now + (55 * 60) };

  console.log('📝 JWT Payload:', JSON.stringify(payload, null, 2));

  const privateKey = forge.pki.privateKeyFromPem(PRIVATE_KEY);
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const message = `${encodedHeader}.${encodedPayload}`;
  const md = forge.md.sha256.create();
  md.update(message, 'utf8');
  const signature = privateKey.sign(md);
  const encodedSig = Buffer.from(signature, 'binary').toString('base64url');

  return `${encodedHeader}.${encodedPayload}.${encodedSig}`;
}

function main() {
  console.log('🚀 JKUAT Attendance — Snowflake API Test\n');
  const jwt = generateJWT();
  const requestId = generateUUID();

  console.log('\n✅ JWT Generated!');
  console.log('\n─── THUNDER CLIENT SETUP ───────────────────────────────');
  console.log(`URL: https://ovb92403.snowflakecomputing.com/api/v2/statements?requestId=${requestId}`);
  console.log('Method: POST\n');
  console.log('Headers:');
  console.log(`  Authorization: Bearer ${jwt}`);
  console.log('  X-Snowflake-Authorization-Token-Type: KEYPAIR_JWT');
  console.log('  Content-Type: application/json\n');
  console.log('Body:');
  console.log(JSON.stringify({
    statement: "SELECT CURRENT_USER(), CURRENT_WAREHOUSE(), CURRENT_DATABASE(), CURRENT_SCHEMA()",
    timeout: 10,
    warehouse: WAREHOUSE,
    database: DATABASE,
    schema: SCHEMA,
  }, null, 2));
}

main();