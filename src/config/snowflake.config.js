export const SNOWFLAKE_CONFIG = {
  accountIdentifier: 'ovb92403.us-west-2',
  jwtAccountIdentifier: 'OVB92403',
  username: 'ATTENDANCE_API_USER',
  publicKeyFingerprint: 'SHA256:mABEmpUTSAGKgGZ/GYd6lyeVX4SJNZjtDpFEJ3pE7Bc=',
  warehouse: 'XS_ATTENDANCE_API_WH',   // UPPERCASE — Snowflake API is case-sensitive
  database: 'ATTENDANCE_DB',
  schema: 'CORE',
  role: 'ATTENDANCE_APP_ROLE',          // UPPERCASE — Snowflake API is case-sensitive
  jwtExpiry: 55 * 60,
};