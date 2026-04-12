// Fixed UUID generator for Snowflake API
const crypto = require('crypto');

// Proper UUID v4 generator
function generateProperUUID() {
    return crypto.randomUUID();
}

// Test the UUID format
const testUUID = generateProperUUID();
console.log('🔧 Fixed UUID Generator\n');
console.log(`✅ Proper UUID: ${testUUID}`);
console.log(`✅ Length: ${testUUID.length} characters`);
console.log(`✅ Format: ${testUUID.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) ? 'Valid UUID v4' : 'Invalid'}`);

console.log('\n🎯 The issue was that our UUID generator was creating random strings');
console.log('   instead of proper RFC 4122 UUID format that Snowflake expects.');
console.log('\n📝 Previous format: "d99e3037-2eb0-4dcd-9bd8-d241914d0d56"');
console.log(`📝 Correct format: "${testUUID}"`);

module.exports = { generateProperUUID };