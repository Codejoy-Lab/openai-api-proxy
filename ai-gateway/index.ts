// index.ts
import { randomUUID } from 'crypto';
import pino from 'pino';

// --- Configuration Interface ---
interface ProviderConfig {
    gatewayUrl: string;
    backendAuthHeader: string; // Header name expected FROM CLIENT containing the backend key
    backendAuthPrefix?: string; // Optional prefix like 'Bearer '
}

// --- Configuration Loading & Validation ---
const config: Map<string, ProviderConfig> = new Map();
// The token used for the 'cf-aig-authorization' header, authenticating the proxy TO the AI Gateway
const cfAigToken = process.env.CF_API_TOKEN;

if (!cfAigToken) {
    console.error("FATAL: CF_API_TOKEN environment variable is not set (required for 'cf-aig-authorization').");
    process.exit(1); // Exit if essential token is missing
}

// Define providers and how they expect backend authentication
const providerDefinitions: { [key: string]: Omit<ProviderConfig, 'gatewayUrl'> } = {
    'anthropic': { backendAuthHeader: 'x-api-key', backendAuthPrefix: '' },
    'openai': { backendAuthHeader: 'Authorization', backendAuthPrefix: 'Bearer ' },
    'google-ai-studio': { backendAuthHeader: 'x-goog-api-key', backendAuthPrefix: '' },
};

let configIsValid = true;
console.log("Loading provider configurations (Cloudflare AI Gateway endpoints):");
for (const providerKey in providerDefinitions) {
    const gatewayUrlVar = `CF_GATEWAY_URL_${providerKey.toUpperCase().replace(/-/g, '_')}`;
    const gatewayUrl = process.env[gatewayUrlVar];
    const providerMeta = providerDefinitions[providerKey];

    if (!gatewayUrl) {
        console.error(`FATAL: Environment variable ${gatewayUrlVar} for provider '${providerKey}' is not set.`);
        configIsValid = false;
        continue;
    }
    if (!gatewayUrl.startsWith('http://') && !gatewayUrl.startsWith('https://')) {
        console.error(`FATAL: Invalid URL format for ${gatewayUrlVar}: ${gatewayUrl}`);
        configIsValid = false;
    } else {
        config.set(providerKey, {
            gatewayUrl: gatewayUrl,
            backendAuthHeader: providerMeta.backendAuthHeader,
            backendAuthPrefix: providerMeta.backendAuthPrefix,
        });
        console.log(` - Loaded ${providerKey}: ${gatewayUrlVar} = ${gatewayUrl} (Backend Auth: ${providerMeta.backendAuthHeader})`);
    }
}

if (!configIsValid) {
    console.error("FATAL: Provider configuration errors detected. Please set all required CF_GATEWAY_URL_* variables correctly. Exiting.");
    process.exit(1);
}

// --- General Proxy Config ---
const PORT = parseInt(process.env.PORT || '9000', 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT || '30000', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// --- Logger Setup ---
const logger = pino({
    level: LOG_LEVEL,
    formatters: { level: (label) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
});

// --- Startup Logging ---
logger.info(`Starting Multi-Provider AI Proxy server on port ${PORT}`);
logger.info(`Configured providers: [${Array.from(config.keys()).join(', ')}]`);
logger.info(`Authentication TO Cloudflare AI Gateway uses 'cf-aig-authorization' header.`);
logger.warn('Proxy endpoint is open. Ensure network-level security if required.');
logger.warn('Clients MUST provide the correct backend API key in the appropriate header (Authorization, x-api-key, x-goog-api-key).');


// --- Bun HTTP Server ---
Bun.serve({
  port: PORT,
  // --- Request Handler ---
  async fetch(request: Request): Promise<Response> {
    const requestId = randomUUID();
    const requestStart = Date.now();
    const url = new URL(request.url);
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('remote-addr') || 'unknown';

    // --- CORS Preflight Handling ---
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204, // No Content
            headers: {
                'Access-Control-Allow-Origin': '*', // Be specific in production
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-goog-api-key, anthropic-version, x-use-openai-format', // Ensure all needed headers are allowed
                'Access-Control-Max-Age': '86400', // Cache preflight response for 1 day
            },
        });
     }

    // Create logger with request context *after* handling OPTIONS
    const childLogger = logger.child({ requestId, ip, method: request.method, path: url.pathname });
    childLogger.info('Received request');

    // --- Health Check ---
    if (url.pathname === '/healthz') {
      childLogger.info({ status: 200 }, 'Health check successful');
      return new Response('OK', { status: 200 });
    }

    // --- Provider Routing ---
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const providerKey = pathSegments[0];

    if (!providerKey || !config.has(providerKey)) {
        childLogger.warn({ status: 404, requestedProvider: providerKey }, 'Unknown or unconfigured provider route');
        return new Response(JSON.stringify({ error: `Invalid route. Use /<provider>/<original_path> where provider is one of [${Array.from(config.keys()).join(', ')}]` }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }

    const providerConfig = config.get(providerKey)!;
    const remainingPath = '/' + pathSegments.slice(1).join('/');
    const targetUrl = `${providerConfig.gatewayUrl}${remainingPath === '/' ? '' : remainingPath}${url.search}`;

    childLogger.info({ provider: providerKey, targetUrl }, 'Routing request');

    // --- Backend Authentication Header Extraction from Client ---
    const backendAuthHeaderName = providerConfig.backendAuthHeader;
    const backendAuthHeaderValue = request.headers.get(backendAuthHeaderName);

    if (!backendAuthHeaderValue) {
        childLogger.warn({ status: 401, provider: providerKey, requiredHeader: backendAuthHeaderName }, `Missing required backend authentication header from client`);
        return new Response(JSON.stringify({ error: `Missing required authentication header for ${providerKey}: ${backendAuthHeaderName}` }), {
            status: 401, // Unauthorized
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }

    // --- Request Body Processing (Read Raw, Parse for Checks) ---
    let bodyString: string | undefined; // Holds the raw body text
    let isStreamRequest = false;
    let parsedRequestBody: any; // Holds the parsed body for checks

    try {
        if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
            bodyString = await request.text();
            const contentType = request.headers.get('content-type');
            if (contentType?.includes('application/json') && bodyString) {
                try {
                    parsedRequestBody = JSON.parse(bodyString);
                    isStreamRequest = parsedRequestBody?.stream === true;
                    // Optional: Add body modifications here and re-serialize into bodyString if needed
                } catch (parseError: any) {
                    childLogger.warn({ err: parseError.message }, "Failed to parse JSON body despite Content-Type header. Forwarding raw text.");
                    isStreamRequest = false;
                }
            } else if (bodyString) {
                 childLogger.debug({ contentType }, "Request body is not JSON or Content-Type is missing/different. Forwarding raw text.");
                 isStreamRequest = false;
            } else {
                childLogger.debug("Request body is empty.");
                isStreamRequest = false;
            }
        }
    } catch (error: any) {
        childLogger.error({ err: error.message, stack: error.stack, status: 500 }, 'Failed to read request body text');
        bodyString = undefined;
        return new Response(JSON.stringify({ error: 'Failed to read request body' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }});
    }

    // --- Build Forward Request Headers ---
    const forwardHeaders = new Headers();
    forwardHeaders.set('cf-aig-authorization', `Bearer ${cfAigToken}`);
    forwardHeaders.set(backendAuthHeaderName, backendAuthHeaderValue);
    forwardHeaders.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
    if (providerKey === 'anthropic') {
        forwardHeaders.set('anthropic-version', request.headers.get('anthropic-version') || '2023-06-01');
    }
    // Add other pass-through headers if needed

    // --- Build Fetch Options ---
    const fetchOptions: RequestInit = {
      method: request.method,
      headers: forwardHeaders,
      body: bodyString, // Use the raw (or potentially modified) bodyString
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };

    // --- Execute Forward and Handle Response ---
    try {
      childLogger.info({ model: parsedRequestBody?.model, stream: isStreamRequest }, `Forwarding request to ${providerKey} gateway`);

      // --- DEBUG: Log the exact body being forwarded ---
      childLogger.debug({ forwardBody: bodyString }, "Body content being forwarded to gateway");
      if (typeof bodyString === 'string' && (LOG_LEVEL === 'trace' || LOG_LEVEL === 'debug')) { // Only log raw body on trace/debug
          childLogger.trace(`Raw bodyString (length ${bodyString.length}):\n${bodyString}`);
      }
      // --- End DEBUG ---

      const response = await fetch(targetUrl, fetchOptions);
      const duration = Date.now() - requestStart;

      // Prepare response headers, including CORS *AND REMOVING ENCODING*
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*'); // Set CORS for actual response
      // *** FIX: Remove Content-Encoding as Bun likely decompressed the body ***
      responseHeaders.delete('Content-Encoding');
      childLogger.debug("Removed Content-Encoding header before sending response to client."); // Log removal

      // --- Streaming Response ---
      if (isStreamRequest && response.ok && response.body) {
        childLogger.info({ status: response.status, duration }, `Received streaming response from ${providerKey} gateway, piping stream.`);
        // Headers already prepared (CORS set, Content-Encoding removed)
        responseHeaders.set('Content-Type', 'text/event-stream');
        responseHeaders.set('Cache-Control', 'no-cache');
        responseHeaders.set('Connection', 'keep-alive');
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
      }

      // --- Non-Streaming Response ---
      const responseBodyText = await response.text(); // Reads the (likely already decompressed) body
      // Headers already prepared (CORS set, Content-Encoding removed)

      // Ensure correct Content-Type header is present on the response we send back
      if (!responseHeaders.has('Content-Type')) {
          try { JSON.parse(responseBodyText); responseHeaders.set('Content-Type', 'application/json'); } catch { responseHeaders.set('Content-Type', 'text/plain'); }
      }

      // Handle Errors from Gateway/Backend
      if (!response.ok) {
        childLogger.error({ status: response.status, upstreamBody: responseBodyText, duration, provider: providerKey }, `Received error response from ${providerKey} gateway`);
        let errorJson; try { errorJson = JSON.parse(responseBodyText); } catch { errorJson = { error: { type: 'upstream_error', message: responseBodyText } }; }
        if (!responseHeaders.get('Content-Type')?.includes('json')) { responseHeaders.set('Content-Type', 'application/json'); }
        // Headers already prepared (CORS set, Content-Encoding removed)
        return new Response(JSON.stringify(errorJson), { status: response.status, headers: responseHeaders });
      }

      // --- Successful Response & Optional Format Conversion ---
      childLogger.info({ status: response.status, duration, provider: providerKey }, `Received successful response from ${providerKey} gateway`);
      let responseData: any; // Can be string or object
       try {
           if (responseHeaders.get('Content-Type')?.includes('application/json')) { responseData = JSON.parse(responseBodyText); } else { responseData = responseBodyText; }
       } catch (error: any) {
         childLogger.error({ err: error.message, stack: error.stack, responseBody: responseBodyText, provider: providerKey }, `Failed to parse successful ${providerKey} gateway JSON response`);
         responseHeaders.set('Content-Type', 'application/json');
         // Headers already prepared (CORS set, Content-Encoding removed)
         return new Response(JSON.stringify({ error: "Failed to parse upstream JSON response" }), { status: 502, headers: responseHeaders }); // Bad Gateway
       }

      // Anthropic -> OpenAI Conversion (Conditional)
      const useOpenAIFormat = request.headers.get('x-use-openai-format') === 'true';
      if (providerKey === 'anthropic' && typeof responseData === 'object' && responseData !== null && useOpenAIFormat && remainingPath.includes('/messages') && !isStreamRequest) {
        try {
          const transformedData = { /* ... transformation logic ... */ }; // Replace with actual transformation
          childLogger.info("Transformed Anthropic response to OpenAI format");
          responseHeaders.set('Content-Type', 'application/json');
          // Headers already prepared (CORS set, Content-Encoding removed)
          return new Response(JSON.stringify(transformedData), { status: 200, headers: responseHeaders });
        } catch (transformError: any) {
           childLogger.error({ err: transformError.message, stack: transformError.stack, originalData: responseData }, "Failed to transform Anthropic response to OpenAI format");
           responseHeaders.set('Content-Type', 'application/json');
           // Headers already prepared (CORS set, Content-Encoding removed)
           return new Response(JSON.stringify({ error: "Failed to transform response format", original_response: responseData }), { status: 500, headers: responseHeaders });
        }
      }

      // --- Return Original Provider Response ---
      // Headers already prepared (CORS set, Content-Encoding removed)
      return new Response(responseBodyText, { status: 200, headers: responseHeaders });

    } catch (error: any) {
      // --- Handle Fetch Errors ---
      const duration = Date.now() - requestStart;
      // Use fresh headers for proxy-generated errors (no Content-Encoding needed)
      const headers = new Headers({ 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      if (error.name === 'TimeoutError' || error.message.includes('timed out')) {
        childLogger.error({ err: error.message, stack: error.stack, duration, status: 504, provider: providerKey }, `Request to ${providerKey} gateway timed out`);
        return new Response(JSON.stringify({ error: 'Upstream request timed out' }), { status: 504, headers }); // Gateway Timeout
      }
      childLogger.error({ err: error.message, stack: error.stack, duration, status: 502, provider: providerKey }, `Failed to fetch from ${providerKey} gateway`);
      return new Response(JSON.stringify({ error: 'Failed to connect to upstream service' }), { status: 502, headers }); // Bad Gateway
    }
  }, // <-- End of async fetch function

  // --- Global Error Handler ---
  error(error: Error): Response {
      logger.fatal({ err: error.message, stack: error.stack }, 'Unhandled server error occurred');
      // Use fresh headers for fatal errors
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
   }
}); // <-- End of Bun.serve