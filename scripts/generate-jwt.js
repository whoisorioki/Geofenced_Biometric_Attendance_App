const jwt = require('jsonwebtoken');
const fs = require('fs');

// Your exact Snowflake account prefix
const accountPrefix = 'EGMDCOU-VDB68761'; 

// Snowflake requires the issuer account to be uppercase and dots replaced with hyphens
const formattedAccount = accountPrefix.toUpperCase().replace(/\./g, '-');
const userName = 'ATTENDANCE_API_USER';
const publicKeyFingerprint = 'SHA256:mABEmpUTSAGKgGZ/GYd6lyeVX4SJNZjtDpFEJ3pE7Bc=';

// Read the private key 
const privateKey = fs.readFileSync('./rsa_key.p8', 'utf8');

const payload = {
    iss: `${formattedAccount}.${userName}.${publicKeyFingerprint}`,
    sub: `${formattedAccount}.${userName}`,
};

const token = jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: '1h'
});

console.log("\n=== YOUR TEMPORARY JWT ===");
console.log(token);
console.log("==========================\n");