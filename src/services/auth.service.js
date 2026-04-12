import forge from "node-forge";
import { SNOWFLAKE_CONFIG } from '../config/snowflake.config';

const PRIVATE_KEY = process.env.SNOWFLAKE_PRIVATE_KEY_PEM;

export const generateJWT = () => {
    if (!PRIVATE_KEY) {
        throw new Error('Missing Snowflake private key. Set SNOWFLAKE_PRIVATE_KEY_PEM in your environment or provision it securely at runtime.');
    }

    const removeB64Padding = base64 => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    function encodeB64(str) {
        const encodedB64 = forge.util.encode64(str);
        return removeB64Padding(encodedB64);
    }

    // Read private key - in production you'd read from secure storage
    const privateKey = forge.pki.privateKeyFromPem(PRIVATE_KEY);
    const md = forge.md.sha256.create();

    const header = {
        "typ": "JWT",
        "alg": "RS256"
    };

    const rawJwtAccount = SNOWFLAKE_CONFIG.jwtAccountIdentifier || SNOWFLAKE_CONFIG.accountIdentifier;
    const normalizedJwtAccount = rawJwtAccount.includes('.') ? rawJwtAccount.split('.')[0] : rawJwtAccount;
    const jwtAccount = normalizedJwtAccount.toUpperCase().replace(/\./g, '-');
    const jwtUsername = SNOWFLAKE_CONFIG.username.toUpperCase();
    const qualified_username = `${jwtAccount}.${jwtUsername}`;

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const iat = nowInSeconds - 60;
    const exp = nowInSeconds + SNOWFLAKE_CONFIG.jwtExpiry;

    const payload = {
        // Issuer format: ACCOUNT.USERNAME.FINGERPRINT
        iss: `${qualified_username}.${SNOWFLAKE_CONFIG.publicKeyFingerprint}`,
        // Subject: ACCOUNT.USERNAME
        sub: qualified_username,
        // Issue time: current time with small skew allowance
        iat,
        // Expiration: based on config
        exp
    };

    console.log('🔐 JWT claims:', {
        iss: payload.iss,
        sub: payload.sub,
        iat: payload.iat,
        exp: payload.exp,
    });

    const strHeader = JSON.stringify(header);
    const strPayload = JSON.stringify(payload);
    const headerB64 = encodeB64(strHeader);
    const payloadB64 = encodeB64(strPayload);
    const preHash = headerB64 + '.' + payloadB64;

    md.update(preHash, 'utf8');
    const signature = privateKey.sign(md);
    const signature64 = encodeB64(signature);

    return headerB64 + '.' + payloadB64 + '.' + signature64;
};