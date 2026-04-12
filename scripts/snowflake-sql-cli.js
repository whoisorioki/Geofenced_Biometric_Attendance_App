const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const forge = require('node-forge');

const defaults = {
    accountIdentifier: 'ovb92403.us-west-2',
    jwtAccountIdentifier: 'OVB92403',
    username: 'ATTENDANCE_API_USER',
    publicKeyFingerprint: 'SHA256:mABEmpUTSAGKgGZ/GYd6lyeVX4SJNZjtDpFEJ3pE7Bc=',
    warehouse: 'XS_ATTENDANCE_API_WH',
    database: 'ATTENDANCE_DB',
    schema: 'CORE',
    role: 'ATTENDANCE_APP_ROLE',
    timeout: 30,
    pollMs: 500,
    maxPollAttempts: 60,
};

function parseArgs(argv) {
    const args = {
        sql: null,
        file: null,
        positional: [],
        json: false,
        timeout: defaults.timeout,
        pollMs: defaults.pollMs,
        maxPollAttempts: defaults.maxPollAttempts,
        warehouse: process.env.SNOWFLAKE_WAREHOUSE || defaults.warehouse,
        database: process.env.SNOWFLAKE_DATABASE || defaults.database,
        schema: process.env.SNOWFLAKE_SCHEMA || defaults.schema,
        role: process.env.SNOWFLAKE_ROLE || defaults.role,
    };

    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--sql') {
            args.sql = argv[++i] || '';
        } else if (token === '--file') {
            args.file = argv[++i] || '';
        } else if (token === '--json') {
            args.json = true;
        } else if (token === '--timeout') {
            args.timeout = Number(argv[++i] || defaults.timeout);
        } else if (token === '--poll-ms') {
            args.pollMs = Number(argv[++i] || defaults.pollMs);
        } else if (token === '--max-polls') {
            args.maxPollAttempts = Number(argv[++i] || defaults.maxPollAttempts);
        } else if (token === '--warehouse') {
            args.warehouse = argv[++i] || args.warehouse;
        } else if (token === '--database') {
            args.database = argv[++i] || args.database;
        } else if (token === '--schema') {
            args.schema = argv[++i] || args.schema;
        } else if (token === '--role') {
            args.role = argv[++i] || args.role;
        } else if (token === '--help' || token === '-h') {
            args.help = true;
        } else {
            args.positional.push(token);
        }
    }

    return args;
}

function getConfig() {
    const privateKeyPath = process.env.SNOWFLAKE_PRIVATE_KEY_PATH || './rsa_key.p8';
    return {
        accountIdentifier: process.env.SNOWFLAKE_ACCOUNT_IDENTIFIER || defaults.accountIdentifier,
        jwtAccountIdentifier: process.env.SNOWFLAKE_JWT_ACCOUNT_IDENTIFIER || defaults.jwtAccountIdentifier,
        username: process.env.SNOWFLAKE_USERNAME || defaults.username,
        publicKeyFingerprint: process.env.SNOWFLAKE_PUBLIC_KEY_FINGERPRINT || defaults.publicKeyFingerprint,
        privateKeyPath: path.resolve(process.cwd(), privateKeyPath),
    };
}

function generateJWT(config) {
    const privateKeyPem = fs.readFileSync(config.privateKeyPath, 'utf8');
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
    const now = Math.floor(Date.now() / 1000);

    const payload = {
        iss: `${config.jwtAccountIdentifier}.${config.username}.${config.publicKeyFingerprint}`,
        sub: `${config.jwtAccountIdentifier}.${config.username}`,
        iat: now - 60,
        exp: now + 3300,
    };

    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const message = `${header}.${body}`;
    const md = forge.md.sha256.create();
    md.update(message, 'utf8');
    const signature = Buffer.from(privateKey.sign(md), 'binary').toString('base64url');
    return `${message}.${signature}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseResponseBody(response) {
    const rawBody = await response.text();
    try {
        return rawBody ? JSON.parse(rawBody) : {};
    } catch {
        return { message: rawBody };
    }
}

async function pollUntilComplete(baseUrl, statusPath, requestArgs, config) {
    for (let i = 1; i <= requestArgs.maxPollAttempts; i += 1) {
        await sleep(requestArgs.pollMs);

        const pollResponse = await fetch(`${baseUrl}${statusPath}`, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${generateJWT(config)}`,
                'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
            },
        });

        const pollData = await parseResponseBody(pollResponse);

        if (!pollResponse.ok) {
            throw new Error(pollData?.message || `Snowflake poll failed (${pollResponse.status})`);
        }

        if (pollData?.statementStatusUrl && pollData?.code === '333334') {
            continue;
        }

        return pollData;
    }

    throw new Error('Snowflake async statement timed out while waiting for completion.');
}

async function executeStatement(statement, requestArgs, config) {
    const requestId = crypto.randomUUID();
    const baseUrl = `https://${config.accountIdentifier}.snowflakecomputing.com`;

    const response = await fetch(`${baseUrl}/api/v2/statements?requestId=${requestId}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${generateJWT(config)}`,
            'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
        },
        body: JSON.stringify({
            statement,
            timeout: requestArgs.timeout,
            warehouse: requestArgs.warehouse,
            database: requestArgs.database,
            schema: requestArgs.schema,
            role: requestArgs.role,
        }),
    });

    let data = await parseResponseBody(response);

    if (response.status === 202 || data?.statementStatusUrl) {
        data = await pollUntilComplete(baseUrl, data.statementStatusUrl, requestArgs, config);
    }

    if (!response.ok) {
        throw new Error(data?.message || `Snowflake query failed (${response.status})`);
    }

    return data;
}

function printUsage() {
    console.log('Usage:');
    console.log('  node scripts/snowflake-sql-cli.js --sql "SELECT CURRENT_TIMESTAMP()"');
    console.log('  node scripts/snowflake-sql-cli.js --file database/sql/timetable_patch.sql');
    console.log('Options:');
    console.log('  --json --timeout <sec> --poll-ms <ms> --max-polls <n>');
    console.log('  --warehouse <name> --database <name> --schema <name> --role <name>');
}

async function main() {
    const args = parseArgs(process.argv);

    if (!args.sql && !args.file && args.positional.length > 0) {
        if (args.positional.length === 1) {
            const maybePath = path.resolve(process.cwd(), args.positional[0]);
            if (fs.existsSync(maybePath) && fs.statSync(maybePath).isFile() && maybePath.toLowerCase().endsWith('.sql')) {
                args.file = args.positional[0];
            } else {
                args.sql = args.positional[0];
            }
        } else {
            args.sql = args.positional.join(' ');
        }
    }

    if (args.help || (!args.sql && !args.file)) {
        printUsage();
        process.exit(args.help ? 0 : 1);
    }

    let statement = args.sql;
    if (args.file) {
        const sqlPath = path.resolve(process.cwd(), args.file);
        statement = fs.readFileSync(sqlPath, 'utf8');
    }

    statement = String(statement || '').trim();
    if (!statement) {
        throw new Error('Empty SQL statement.');
    }

    const config = getConfig();
    const result = await executeStatement(statement, args, config);

    if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    const rows = result?.data || [];
    const code = result?.code || 'OK';
    const message = result?.message || 'Statement executed';
    console.log(`Code: ${code}`);
    console.log(`Message: ${message}`);
    console.log(`Rows: ${rows.length}`);

    if (rows.length > 0) {
        console.table(rows);
    }
}

main().catch((error) => {
    console.error('Snowflake CLI error:', error.message || String(error));
    process.exit(1);
});
