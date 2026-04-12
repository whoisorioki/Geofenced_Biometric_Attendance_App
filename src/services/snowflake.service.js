import { generateJWT } from './auth.service';
import { SNOWFLAKE_CONFIG } from '../config/snowflake.config';

const VALID_BINDING_TYPES = new Set([
  'FIXED',
  'REAL',
  'DECFLOAT',
  'TEXT',
  'BINARY',
  'BOOLEAN',
  'DATE',
  'TIME',
  'TIMESTAMP_LTZ',
  'TIMESTAMP_NTZ',
  'TIMESTAMP_TZ',
]);

// Web-compatible UUID generator
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const BASE_URL = `https://${SNOWFLAKE_CONFIG.accountIdentifier}.snowflakecomputing.com`;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const NETWORK_RETRY_DELAYS_MS = [300, 900, 1800];

const isRetriableNetworkError = (error) => {
  const message = String(error?.message || '');
  return (
    error?.name === 'TypeError' ||
    /Failed to fetch|NetworkError|ERR_NETWORK_CHANGED|Load failed/i.test(message)
  );
};

const fetchWithRetry = async (url, options, label) => {
  const maxAttempts = NETWORK_RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (!isRetriableNetworkError(error) || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = NETWORK_RETRY_DELAYS_MS[attempt - 1] || 1000;
      console.warn(
        `🌐 ${label} network issue (${error.message || 'fetch failed'}). Retrying ${attempt}/${maxAttempts - 1} in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }

  throw new Error('Unexpected network retry failure.');
};

const parseResponseBody = async (response) => {
  const rawBody = await response.text();
  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { message: rawBody };
  }
};

const pollStatementUntilComplete = async (statementStatusUrl) => {
  if (!statementStatusUrl) {
    throw new Error('Snowflake async response missing statementStatusUrl.');
  }

  const maxAttempts = 30;
  const pollIntervalMs = 500;  // 500ms polls — halves wait time vs 1000ms

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await sleep(pollIntervalMs);

    const pollResponse = await fetchWithRetry(`${BASE_URL}${statementStatusUrl}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${generateJWT()}`,
        'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
      },
    }, 'Snowflake poll');

    const pollData = await parseResponseBody(pollResponse);
    console.log(`⏱️ Poll attempt ${attempt}/${maxAttempts}:`, pollResponse.status, pollData?.message || pollData?.code);

    if (!pollResponse.ok) {
      throw new Error(pollData.message || `Snowflake poll failed (${pollResponse.status})`);
    }

    if (pollData?.statementStatusUrl && pollData?.code === '333334') {
      continue;
    }

    return pollData;
  }

  throw new Error('Snowflake async statement timed out while waiting for completion.');
};

const normalizeBindings = (bindings = {}) => {
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new Error('SQL API contract violation: bindings must be an object.');
  }

  const normalized = {};
  for (const [key, value] of Object.entries(bindings)) {
    if (!/^\d+$/.test(key)) {
      throw new Error(`SQL API contract violation: binding key "${key}" must be numeric.`);
    }
    if (!value || typeof value !== 'object') {
      throw new Error(`SQL API contract violation: binding "${key}" must be an object.`);
    }

    const type = String(value.type || '').toUpperCase();
    if (!VALID_BINDING_TYPES.has(type)) {
      throw new Error(`SQL API contract violation: binding "${key}" has invalid type "${value.type}".`);
    }

    normalized[key] = {
      type,
      value: value.value == null ? '' : String(value.value),
    };
  }

  return normalized;
};

export const executeSQL = async (statement, bindings = {}) => {
  try {
    if (!statement || typeof statement !== 'string' || !statement.trim()) {
      throw new Error('SQL API contract violation: statement must be a non-empty string.');
    }

    const normalizedBindings = normalizeBindings(bindings);

    console.log('🔄 Starting Snowflake execution...');
    console.log('📝 SQL Statement:', statement);
    console.log('🔗 Bindings:', normalizedBindings);

    const jwt = generateJWT();
    console.log('🔐 JWT generated successfully');

    const requestId = generateUUID();
    console.log('🆔 Request ID:', requestId);

    const response = await fetchWithRetry(
      `${BASE_URL}/api/v2/statements?requestId=${requestId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
          'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
        },
        body: JSON.stringify({
          statement,
          bindings: normalizedBindings,
          timeout: 15,
          warehouse: SNOWFLAKE_CONFIG.warehouse,
          database: SNOWFLAKE_CONFIG.database,
          schema: SNOWFLAKE_CONFIG.schema,
          role: SNOWFLAKE_CONFIG.role,
        }),
      },
      'Snowflake submit'
    );

    console.log('📡 Response status:', response.status);
    let data = await parseResponseBody(response);

    if (response.status === 202 || data?.statementStatusUrl) {
      console.log('⌛ Snowflake statement is async; polling for completion...');
      data = await pollStatementUntilComplete(data.statementStatusUrl);
    }

    console.log('📊 Response data:', data);

    if (!response.ok) {
      console.error('❌ Snowflake error:', data);
      throw new Error(data.message || `Snowflake query failed (${response.status})`);
    }

    console.log('✅ Snowflake execution successful');
    return data;

  } catch (error) {
    console.error('🔥 Snowflake service error:', error);

    if (isRetriableNetworkError(error)) {
      throw new Error('Network changed during Snowflake request. Please check your connection and retry.');
    }

    throw error;
  }
};