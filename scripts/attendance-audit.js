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
    console.log('=== ATTENDANCE VS TIMETABLE AUDIT (latest 20) ===\n');

    const rows = await sql(`
    WITH ATT AS (
      SELECT
        FA.ATTENDANCE_ID,
        FA.STUDENT_ID,
        FA.COURSE_ID,
        FA.CLASS_ID AS RECORDED_CLASS_ID,
        FA.STATUS,
        FA.CHECK_IN_TIME,
        CR.CLASS_ID AS EXPECTED_CLASS_ID,
        CR.DAY_OF_WEEK AS EXPECTED_DAY,
        CR.START_TIME,
        CR.END_TIME,
        CASE DAYOFWEEKISO(FA.CHECK_IN_TIME)
          WHEN 1 THEN 'MONDAY'
          WHEN 2 THEN 'TUESDAY'
          WHEN 3 THEN 'WEDNESDAY'
          WHEN 4 THEN 'THURSDAY'
          WHEN 5 THEN 'FRIDAY'
          WHEN 6 THEN 'SATURDAY'
          WHEN 7 THEN 'SUNDAY'
        END AS CHECKIN_DAY,
        TO_VARCHAR(TO_TIME(FA.CHECK_IN_TIME), 'HH24:MI') AS CHECKIN_CLOCK
      FROM ATTENDANCE_DB.CORE.FACT_ATTENDANCE FA
      LEFT JOIN ATTENDANCE_DB.CORE.DIM_COURSE CR
        ON CR.COURSE_ID = FA.COURSE_ID
    )
    SELECT
      ATTENDANCE_ID,
      STUDENT_ID,
      COURSE_ID,
      STATUS,
      TO_VARCHAR(CHECK_IN_TIME, 'YYYY-MM-DD HH24:MI:SS') AS CHECK_IN_TIME,
      CHECKIN_DAY,
      CHECKIN_CLOCK,
      EXPECTED_DAY,
      START_TIME,
      END_TIME,
      RECORDED_CLASS_ID,
      EXPECTED_CLASS_ID,
      CASE
        WHEN EXPECTED_CLASS_ID IS NULL THEN 'NO_TIMETABLE'
        WHEN RECORDED_CLASS_ID = EXPECTED_CLASS_ID THEN 'OK'
        ELSE 'MISMATCH'
      END AS PLACE_CHECK,
      CASE
        WHEN EXPECTED_DAY IS NULL OR START_TIME IS NULL OR END_TIME IS NULL THEN 'NO_TIMETABLE'
        WHEN CHECKIN_DAY <> EXPECTED_DAY THEN 'WRONG_DAY'
        WHEN TO_TIME(CHECK_IN_TIME) BETWEEN TO_TIME(START_TIME) AND TO_TIME(END_TIME) THEN 'ON_TIME_WINDOW'
        ELSE 'OUTSIDE_TIME_WINDOW'
      END AS TIME_CHECK
    FROM ATT
    ORDER BY CHECK_IN_TIME DESC
    LIMIT 20
  `);

    if (!rows.length) {
        console.log('No attendance records found.');
        return;
    }

    rows.forEach((r, i) => {
        console.log(`${i + 1}. ${r[1]} | ${r[2]} | ${r[4]} | status=${r[3]}`);
        console.log(`   place: ${r[10]} vs expected ${r[11]} => ${r[12]}`);
        console.log(`   time : ${r[6]} ${r[5]} vs ${r[7]} ${r[8]}-${r[9]} => ${r[13]}`);
    });

    const summary = await sql(`
    WITH X AS (
      WITH ATT AS (
        SELECT
          FA.COURSE_ID,
          FA.CLASS_ID AS RECORDED_CLASS_ID,
          FA.CHECK_IN_TIME,
          CR.CLASS_ID AS EXPECTED_CLASS_ID,
          CR.DAY_OF_WEEK AS EXPECTED_DAY,
          CR.START_TIME,
          CR.END_TIME,
          CASE DAYOFWEEKISO(FA.CHECK_IN_TIME)
            WHEN 1 THEN 'MONDAY'
            WHEN 2 THEN 'TUESDAY'
            WHEN 3 THEN 'WEDNESDAY'
            WHEN 4 THEN 'THURSDAY'
            WHEN 5 THEN 'FRIDAY'
            WHEN 6 THEN 'SATURDAY'
            WHEN 7 THEN 'SUNDAY'
          END AS CHECKIN_DAY
        FROM ATTENDANCE_DB.CORE.FACT_ATTENDANCE FA
        LEFT JOIN ATTENDANCE_DB.CORE.DIM_COURSE CR ON CR.COURSE_ID = FA.COURSE_ID
      )
      SELECT
        CASE
          WHEN EXPECTED_CLASS_ID IS NULL THEN 'NO_TIMETABLE'
          WHEN RECORDED_CLASS_ID = EXPECTED_CLASS_ID THEN 'OK'
          ELSE 'MISMATCH'
        END AS PLACE_CHECK,
        CASE
          WHEN EXPECTED_DAY IS NULL OR START_TIME IS NULL OR END_TIME IS NULL THEN 'NO_TIMETABLE'
          WHEN CHECKIN_DAY <> EXPECTED_DAY THEN 'WRONG_DAY'
          WHEN TO_TIME(CHECK_IN_TIME) BETWEEN TO_TIME(START_TIME) AND TO_TIME(END_TIME) THEN 'ON_TIME_WINDOW'
          ELSE 'OUTSIDE_TIME_WINDOW'
        END AS TIME_CHECK
      FROM ATT
    )
    SELECT PLACE_CHECK, TIME_CHECK, COUNT(*)
    FROM X
    GROUP BY PLACE_CHECK, TIME_CHECK
    ORDER BY COUNT(*) DESC
  `);

    console.log('\n=== SUMMARY ===');
    summary.forEach((r) => {
        console.log(`place=${r[0].padEnd(12)} time=${r[1].padEnd(18)} count=${r[2]}`);
    });
}

main().catch((e) => {
    console.error('Audit failed:', e.message);
    process.exit(1);
});
