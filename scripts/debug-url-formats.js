// URL Format Checker for Snowflake API
const SNOWFLAKE_CONFIG = {
    accountIdentifier: 'EGMDCOU-VDB68761.af-south-1.aws',
    username: 'WHOISORIOKI',
    warehouse: 'COMPUTE_WH',
};

console.log('🔍 Snowflake URL Format Debug\n');

// Current URL format
const currentURL = `https://${SNOWFLAKE_CONFIG.accountIdentifier}.snowflakecomputing.com/api/v2/statements`;
console.log('✅ Current URL Format:');
console.log(currentURL);

// Alternative formats to try
console.log('\n🔄 Alternative URL Formats to Test:');

// Format 1: Without region/cloud info 
const shortAccount = SNOWFLAKE_CONFIG.accountIdentifier.split('.')[0]; // EGMDCOU-VDB68761
const alt1 = `https://${shortAccount}.snowflakecomputing.com/api/v2/statements`;
console.log('1️⃣  Short Account Format:');
console.log(alt1);

// Format 2: Legacy format
const legacyAccount = shortAccount.replace('-', '.');
const alt2 = `https://${legacyAccount}.snowflakecomputing.com/api/v2/statements`;
console.log('2️⃣  Legacy Format (dots instead of hyphens):');
console.log(alt2);

// Format 3: Without AWS suffix
const noAwsAccount = SNOWFLAKE_CONFIG.accountIdentifier.split('.aws')[0]; // EGMDCOU-VDB68761.af-south-1
const alt3 = `https://${noAwsAccount}.snowflakecomputing.com/api/v2/statements`;
console.log('3️⃣  Without .aws suffix:');
console.log(alt3);

console.log('\n🎯 Testing Plan:');
console.log('1. First try the SIMPLE connection test with current format');
console.log('2. If 404, try alternative formats above');
console.log('3. Check if SQL API is enabled on your account');
console.log('4. Verify account name in Snowflake web console');

console.log('\n💡 Quick Check:');
console.log('- Log into Snowflake web console');
console.log('- Look at the URL in your browser');
console.log('- The account identifier should match one of the formats above');