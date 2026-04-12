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
    const course = await sql(`
    SELECT COURSE_ID, COURSE_TITLE, DAY_OF_WEEK, START_TIME, END_TIME, CLASS_ID, LECTURER_NAME
    FROM ATTENDANCE_DB.CORE.DIM_COURSE
    WHERE COURSE_ID='SMA2419'
  `);

    const now = await sql(`
    SELECT
      DAYNAME(CURRENT_DATE()) AS DAY_SHORT,
      CASE DAYOFWEEKISO(CURRENT_DATE())
        WHEN 1 THEN 'MONDAY'
        WHEN 2 THEN 'TUESDAY'
        WHEN 3 THEN 'WEDNESDAY'
        WHEN 4 THEN 'THURSDAY'
        WHEN 5 THEN 'FRIDAY'
        WHEN 6 THEN 'SATURDAY'
        WHEN 7 THEN 'SUNDAY'
      END AS DAY_FULL,
      TO_VARCHAR(CURRENT_TIME(), 'HH24:MI:SS') AS NOW_TIME
  `);

    console.log('SMA2419_ROW:', course);
    console.log('NOW:', now);
}

main().catch((e) => {
    console.error('Check failed:', e.message);
    process.exit(1);
});
