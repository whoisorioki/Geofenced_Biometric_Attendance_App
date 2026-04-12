const forge = require('node-forge');
const crypto = require('crypto');
const fs = require('fs');

// ── Mirrors src/config/snowflake.config.js exactly ─────────────────────────
const ACCOUNT = 'OVB92403';
const USERNAME = 'ATTENDANCE_API_USER';
const FINGERPRINT = 'SHA256:mABEmpUTSAGKgGZ/GYd6lyeVX4SJNZjtDpFEJ3pE7Bc=';
const WAREHOUSE = 'XS_ATTENDANCE_API_WH';
const DATABASE = 'ATTENDANCE_DB';
const SCHEMA = 'CORE';
const ROLE = 'ATTENDANCE_APP_ROLE';
const JWT_EXPIRY = 55 * 60;
const PRIVATE_KEY = fs.readFileSync('./rsa_key.p8', 'utf8');

// ── Mirrors src/services/auth.service.js exactly ───────────────────────────
function generateJWT() {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const iat = nowInSeconds - 60;
    const exp = nowInSeconds + JWT_EXPIRY;
    const qualified_username = `${ACCOUNT}.${USERNAME}`;
    const payload = {
        iss: `${qualified_username}.${FINGERPRINT}`,
        sub: qualified_username,
        iat,
        exp,
    };
    console.log('\n🔐 JWT claims:', JSON.stringify(payload, null, 2));

    const privateKey = forge.pki.privateKeyFromPem(PRIVATE_KEY);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const message = header + '.' + body;
    const md = forge.md.sha256.create();
    md.update(message, 'utf8');
    const sig = Buffer.from(privateKey.sign(md), 'binary').toString('base64url');
    return message + '.' + sig;
}

// ── Mirrors src/services/snowflake.service.js exactly ──────────────────────
const BASE_URL = `https://ovb92403.us-west-2.snowflakecomputing.com`;

async function executeSQL(statement, bindings = {}) {
    const jwt = generateJWT();
    const requestId = crypto.randomUUID();
    const res = await fetch(
        `${BASE_URL}/api/v2/statements?requestId=${requestId}`,
        {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwt}`,
                'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
            },
            body: JSON.stringify({ statement, bindings, timeout: 15, warehouse: WAREHOUSE, database: DATABASE, schema: SCHEMA, role: ROLE }),
        }
    );
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { message: text }; }
    return { status: res.status, data };
}

// ── The exact SQL from CheckInScreen.jsx ───────────────────────────────────
const CHECKIN_SQL = `
  INSERT INTO FACT_ATTENDANCE (
    ATTENDANCE_ID, STUDENT_ID, CLASS_ID, COURSE_ID,
    STATUS, DEVICE_LOCATION, DEVICE_HASH, IP_ADDRESS
  )
  SELECT
    UUID_STRING(), ?, ?, ?,
    CASE
      WHEN (SELECT ENROLLED_DEVICE_HASH FROM DIM_STUDENT WHERE STUDENT_ID = ?) != ?
        THEN 'PROXY-BLOCKED'
      WHEN ST_DWITHIN(
        ST_MAKEPOINT(?, ?),
        (SELECT GEOFENCE_POLYGON FROM DIM_CLASSROOM WHERE CLASS_ID = ?),
        15
      )
        THEN 'PRESENT'
      ELSE 'ABSENT-OUT-OF-BOUNDS'
    END,
    ST_MAKEPOINT(?, ?), ?, 'N/A'
  WHERE EXISTS (SELECT 1 FROM DIM_STUDENT WHERE STUDENT_ID = ? AND IS_ACTIVE = TRUE)
`;

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log(' JKUAT Attendance — Full Local Diagnostic');
    console.log('═══════════════════════════════════════════════════');

    // STEP 1: JWT + auth
    console.log('\n── STEP 1: JWT + Auth ──');
    const authResult = await executeSQL('SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_WAREHOUSE()');
    console.log(`   Status: ${authResult.status}  Message: ${authResult.data.message}`);
    if (authResult.data.data) console.log(`   ✅ Logged in as: ${JSON.stringify(authResult.data.data[0])}`);
    if (authResult.status !== 200) {
        console.log('\n❌ JWT auth failed — stopping. Full error:', JSON.stringify(authResult.data, null, 2));
        process.exit(1);
    }

    // STEP 2: DIM_STUDENT
    console.log('\n── STEP 2: DIM_STUDENT ──');
    const stuResult = await executeSQL('SELECT STUDENT_ID, ENROLLED_DEVICE_HASH, IS_ACTIVE FROM DIM_STUDENT');
    const students = stuResult.data.data || [];
    if (students.length === 0) {
        console.log('   ⚠️  EMPTY — insert a student row first:');
        console.log("      INSERT INTO ATTENDANCE_DB.CORE.DIM_STUDENT (STUDENT_ID, ENROLLED_DEVICE_HASH, IS_ACTIVE)");
        console.log("      VALUES ('STU001', 'YOUR_DEVICE_HASH', TRUE);");
    } else {
        students.forEach(r => console.log(`   ✅ STUDENT_ID=${r[0]}  HASH=${r[1]}  IS_ACTIVE=${r[2]}`));
    }

    // STEP 3: DIM_CLASSROOM geofence
    console.log('\n── STEP 3: DIM_CLASSROOM ──');
    const clsResult = await executeSQL('SELECT CLASS_ID, GEOFENCE_POLYGON IS NOT NULL FROM DIM_CLASSROOM');
    clsResult.data.data?.forEach(r => console.log(`   CLASS_ID=${r[0]}  geofence_set=${r[1]}`));

    // STEP 4: Full INSERT
    console.log('\n── STEP 4: Full check-in INSERT ──');
    if (students.length === 0) {
        console.log('   ⏭  Skipped — no student in DIM_STUDENT yet.');
    } else {
        const studentId = students[0][0];
        const deviceHash = students[0][1];
        const lon = 37.01245, lat = -1.10160; // inside classroom polygon

        const ins = await executeSQL(CHECKIN_SQL, {
            '1': { type: 'TEXT', value: studentId },
            '2': { type: 'TEXT', value: 'LT_01' },
            '3': { type: 'TEXT', value: 'ICS301' },
            '4': { type: 'TEXT', value: studentId },
            '5': { type: 'TEXT', value: deviceHash },
            '6': { type: 'REAL', value: String(lon) },
            '7': { type: 'REAL', value: String(lat) },
            '8': { type: 'TEXT', value: 'LT_01' },
            '9': { type: 'REAL', value: String(lon) },
            '10': { type: 'REAL', value: String(lat) },
            '11': { type: 'TEXT', value: deviceHash },
            '12': { type: 'TEXT', value: studentId },
        });
        console.log(`   Status: ${ins.status}  Message: ${ins.data.message}`);
        if (ins.data.stats) console.log(`   Stats: ${JSON.stringify(ins.data.stats)}`);
        if (ins.status !== 200) {
            console.log('   ❌ INSERT failed:', JSON.stringify(ins.data, null, 2));
        } else {
            console.log('   ✅ INSERT executed');

            // STEP 5: Verify the row
            console.log('\n── STEP 5: FACT_ATTENDANCE (latest rows) ──');
            const ver = await executeSQL('SELECT ATTENDANCE_ID, STUDENT_ID, CLASS_ID, STATUS, CHECK_IN_TIME FROM FACT_ATTENDANCE ORDER BY CHECK_IN_TIME DESC LIMIT 5');
            const rows = ver.data.data || [];
            if (rows.length === 0) {
                console.log('   ⚠️  Still empty — WHERE EXISTS blocked insert (IS_ACTIVE might be false or STUDENT_ID mismatch)');
            } else {
                rows.forEach(r => console.log(`   ✅ ${r[1]} | ${r[2]} | STATUS=${r[3]} | ${r[4]}`));
            }
        }
    }

    console.log('\n═══════════════════════════════════════════════════\n');
}

main().catch(e => console.error('\n💥 FATAL:', e.message));
