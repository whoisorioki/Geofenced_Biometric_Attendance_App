const forge = require('node-forge');
const crypto = require('crypto');
const fs = require('fs');

const ACCOUNT = 'OVB92403';
const USERNAME = 'ATTENDANCE_API_USER';
const FINGERPRINT = 'SHA256:mABEmpUTSAGKgGZ/GYd6lyeVX4SJNZjtDpFEJ3pE7Bc=';
const WAREHOUSE = 'XS_ATTENDANCE_API_WH';
const DATABASE = 'ATTENDANCE_DB';
const SCHEMA = 'CORE';
const ROLE = 'ATTENDANCE_APP_ROLE';
const PRIVATE_KEY = fs.readFileSync('./rsa_key.p8', 'utf8');

function generateJWT() {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: `${ACCOUNT}.${USERNAME}.${FINGERPRINT}`,
        sub: `${ACCOUNT}.${USERNAME}`,
        iat: now - 60,
        exp: now + 3300,
    };

    const privateKey = forge.pki.privateKeyFromPem(PRIVATE_KEY);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const msg = `${header}.${body}`;
    const md = forge.md.sha256.create();
    md.update(msg, 'utf8');
    const sig = Buffer.from(privateKey.sign(md), 'binary').toString('base64url');
    return `${msg}.${sig}`;
}

async function sql(statement) {
    const jwt = generateJWT();
    const res = await fetch(
        `https://ovb92403.us-west-2.snowflakecomputing.com/api/v2/statements?requestId=${crypto.randomUUID()}`,
        {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${jwt}`,
                'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
            },
            body: JSON.stringify({
                statement,
                timeout: 30,
                warehouse: WAREHOUSE,
                database: DATABASE,
                schema: SCHEMA,
                role: ROLE,
            }),
        }
    );

    const data = await res.json();
    if (res.status !== 200) {
        throw new Error(data?.message || `Snowflake error: ${res.status}`);
    }
    return data.data || [];
}

async function main() {
    const rows = await sql(`
    SELECT
      CURRENT_TIMESTAMP() AS CURRENT_TS,
      TO_VARCHAR(CURRENT_TIMESTAMP(), 'YYYY-MM-DD HH24:MI:SS TZHTZM') AS TS_WITH_TZ,
      DATE_PART(TIMEZONE_HOUR, CURRENT_TIMESTAMP()) AS TZ_HOUR,
      DATE_PART(TIMEZONE_MINUTE, CURRENT_TIMESTAMP()) AS TZ_MINUTE,
      TO_VARCHAR(CONVERT_TIMEZONE('UTC','Africa/Nairobi', CURRENT_TIMESTAMP()), 'YYYY-MM-DD HH24:MI:SS TZHTZM') AS TS_NAIROBI
  `);

    const r = rows[0] || [];
    console.log('CURRENT_TS:', r[0]);
    console.log('TS_WITH_TZ:', r[1]);
    console.log('TZ_OFFSET_HOUR:', r[2]);
    console.log('TZ_OFFSET_MINUTE:', r[3]);
    console.log('TS_NAIROBI:', r[4]);
}

main().catch((e) => {
    console.error('Timezone check failed:', e.message);
    process.exit(1);
});
