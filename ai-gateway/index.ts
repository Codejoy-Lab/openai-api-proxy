// index.ts
import { randomUUID } from 'crypto';
import pino from 'pino';

// --- Configuration Interface ---
interface ProviderConfig {
    gatewayUrl: string;
    // Defines the header the backend expects for its API key
    backendAuthHeader: string; // e.g., 'Authorization' or 'x-api-key' or 'x-goog-api-key'
    // Optional prefix for the backend auth value (e.g., 'Bearer ')
    backendAuthPrefix?: string;
}

// --- Configuration Loading & Validation ---
const config: Map<string, ProviderConfig> = new Map();
// The token used for the 'cf-aig-authorization' header, authenticating the proxy TO the AI Gateway
const cfAigToken = process.env.CF_API_TOKEN;

if (!cfAigToken) {
    console.error("FATAL: CF_API_TOKEN environment variable is not set. This token is required for the 'cf-aig-authorization' header.");
    process.exit(1);
}

// Define providers and how they expect backend authentication
// NOTE: Client MUST send the backend key in the specified header when calling this proxy
config.set('anthropic', {
    gatewayUrl: process.env.CF_GATEWAY_URL_ANTHROPIC!, // Add ! for required or handle missing below
    backendAuthHeader: 'x-api-key', // Anthropic uses x-api-key
    backendAuthPrefix: '',          // No prefix needed
});
config.set('openai', {
    gatewayUrl: process.env.CF_GATEWAY_URL_OPENAI!,
    backendAuthHeader: 'Authorization', // OpenAI uses Authorization
    backendAuthPrefix: 'Bearer ',       // Requires 'Bearer ' prefix
});
config.set('google-ai-studio', { // Assuming Gemini via AI Studio endpoint
    gatewayUrl: process.env.CF_GATEWAY_URL_GOOGLE_AI_STUDIO!,
    backendAuthHeader: 'x-goog-api-key', // Google often uses this
    backendAuthPrefix: '',             // No prefix needed
});


let configIsValid = true;
console.log("Loading provider configurations (Cloudflare AI Gateway endpoints):");
for (const [provider, providerConf] of config.entries()) {
    const gatewayUrlVar = `CF_GATEWAY_URL_${provider.toUpperCase().replace(/-/g, '_')}`;
    if (!providerConf.gatewayUrl) {
        console.error(`FATAL: Environment variable ${gatewayUrlVar} for provider '${provider}' is not set.`);
        configIsValid = false;
        continue; // Skip further checks if URL is missing
    }
    if (!providerConf.gatewayUrl.startsWith('http')) {
        console.error(`FATAL: Invalid URL format for ${gatewayUrlVar}: ${providerConf.gatewayUrl}`);
        configIsValid = false;
    } else {
         console.log(` - Loaded ${provider}: ${gatewayUrlVar} = ${providerConf.gatewayUrl}`);
    }
     if (!providerConf.backendAuthHeader) {
        console.error(`FATAL: Backend auth header misconfigured for provider '${provider}'.`);
        configIsValid = false;
    }
}


if (!configIsValid || config.size === 0) {
    console.error("FATAL: Provider configuration errors detected. Exiting.");
    process.exit(1);
}

// --- General Proxy Config ---
const PORT = parseInt(process.env.PORT || '9000', 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT || '30000', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// --- Logger Setup ---
const logger = pino({ /* ... logger config ... */ });

logger.info(`Starting Multi-Provider AI Proxy server on port ${PORT}`);
logger.info(`Configured providers: [${Array.from(config.keys()).join(', ')}]`);
logger.info(`Authentication TO Cloudflare AI Gateway uses 'cf-aig-authorization' header with CF_API_TOKEN.`);
logger.warn('Proxy endpoint is open. Ensure network-level security if required.');
logger.warn('Clients MUST provide the correct backend API key in the appropriate header (e.g., Authorization, x-api-key).');


// --- Bun HTTP Server ---
Bun.serve({
  port: PORT,
  async fetch(request: Request): Promise<Response> {
    const requestId = randomUUID();
    const requestStart = Date.now();
    const url = new URL(request.url);
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('remote-addr') || 'unknown';

    // --- CORS Preflight Handling ---
    if (request.method === 'OPTIONS') { /* ... CORS handling ... */
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                 // IMPORTANT: Ensure client-provided backend auth headers are allowed!
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-goog-api-key, anthropic-version, x-use-openai-format', // Add others as needed
                'Access-Control-Max-Age': '86400',
            },
        });
     }

    const childLogger = logger.child({ requestId, ip, method: request.method, path: url.pathname });
    childLogger.info('Received request');

    // --- Health Check ---
    if (url.pathname === '/healthz') { /* ... health check ... */ }

    // --- Provider Routing ---
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const providerKey = pathSegments[0];

    if (!providerKey || !config.has(providerKey)) {
         childLogger.warn({ status: 404, requestedProvider: providerKey }, 'Unknown or unconfigured provider route');
         return new Response(JSON.stringify({ error: `Invalid route. Use /<provider>/<original_path> where provider is one of [${Array.from(config.keys()).join(', ')}]` }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    const providerConfig = config.get(providerKey)!;
    const remainingPath = '/' + pathSegments.slice(1).join('/');
    const targetUrl = `${providerConfig.gatewayUrl}${remainingPath === '/' ? '' : remainingPath}${url.search}`;

    childLogger.info({ provider: providerKey, targetUrl }, 'Routing request');

    // --- Backend Authentication Header Extraction ---
    // Get the required header name (e.g., 'Authorization' or 'x-api-key')
    const backendAuthHeaderName = providerConfig.backendAuthHeader;
    // Get the value provided by the client
    const backendAuthHeaderValue = request.headers.get(backendAuthHeaderName);

    if (!backendAuthHeaderValue) {
        childLogger.warn({ status: 401, provider: providerKey, requiredHeader: backendAuthHeaderName }, `Missing required backend authentication header from client`);
        return new Response(JSON.stringify({ error: `Missing required authentication header: ${backendAuthHeaderName}` }), {
            status: 401, // Unauthorized
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }

    // --- Request Body Processing ---
    let bodyString: string | undefined; // This will hold the raw body text
    let isStreamRequest = false;
    let parsedRequestBody: any; // To hold the parsed body for checks

    try {
        if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
            // 1. Read the raw body text first
            bodyString = await request.text();

            // 2. Try to parse it IF content type suggests JSON, for checks
            const contentType = request.headers.get('content-type');
            if (contentType?.includes('application/json') && bodyString) {
                try {
                    parsedRequestBody = JSON.parse(bodyString);
                    isStreamRequest = parsedRequestBody?.stream === true; // Check for stream flag

                    // --- Provider-Specific Body Adjustments (Now modifies parsedRequestBody if needed) ---
                    // IMPORTANT: If you modify, you MUST re-serialize ONLY the modified version.
                    // For now, we'll focus on fixing the pass-through.
                    // Example placeholder if modification was needed:
                    // if (providerKey === 'anthropic' && remainingPath.includes('/messages')) {
                    //     const modifiedBody = { ...parsedRequestBody, model: parsedRequestBody.model || 'default', max_tokens: parsedRequestBody.max_tokens || 1024 };
                    //     // If modified, use the *newly* stringified version INSTEAD of original bodyString
                    //     bodyString = JSON.stringify(modifiedBody);
                    //     childLogger.debug("Applied Anthropic body defaults and re-serialized");
                    // }

                    // If NO modifications are made for a provider (like OpenAI/Google currently),
                    // bodyString still holds the ORIGINAL raw text, which is what we want.

                } catch (parseError: any) {
                    childLogger.warn({ err: parseError.message }, "Failed to parse JSON body despite Content-Type header. Forwarding raw text.");
                    // Keep original bodyString (raw text)
                    isStreamRequest = false; // Cannot determine stream status
                }
            } else {
                // If not JSON or no body, bodyString already holds the raw text (or is undefined)
                 childLogger.debug({ contentType }, "Not processing body as JSON based on Content-Type or empty body.");
                 isStreamRequest = false;
            }
        }
    } catch (error: any) {
        // Error reading request.text()
        childLogger.error({ err: error.message, stack: error.stack, status: 500 }, 'Failed to read request body text');
        // Set bodyString to undefined or handle error appropriately
        bodyString = undefined;
        // Potentially return a 500 error here if reading the body fails fundamentally
        return new Response(JSON.stringify({ error: 'Failed to read request body' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }});
    }

    // --- Build Forward Request Headers ---
    const forwardHeaders = new Headers();
    // ... (Set cf-aig-authorization, Backend Auth Header, Content-Type, other headers as before) ...
     // 1. Cloudflare AI Gateway Authentication
    forwardHeaders.set('cf-aig-authorization', `Bearer ${cfAigToken}`);
    // 2. Backend Authentication (forwarded from client)
    forwardHeaders.set(backendAuthHeaderName, backendAuthHeaderValue!); // Add ! because we checked for it earlier
    // 3. Content-Type (forwarded from client or default)
    // Ensure we forward the *original* Content-Type from the client
    forwardHeaders.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
    // 4. Provider-specific NON-AUTH headers
    if (providerKey === 'anthropic') {
        forwardHeaders.set('anthropic-version', request.headers.get('anthropic-version') || '2023-06-01');
    }

    // --- Build Fetch Options ---
    const fetchOptions: RequestInit = {
      method: request.method,
      headers: forwardHeaders,
      // *** Use the potentially unmodified raw bodyString ***
      body: bodyString,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };

    // --- Build Forward Request Headers ---
    const forwardHeaders = new Headers();

    // 1. Add Cloudflare AI Gateway Authentication
    forwardHeaders.set('cf-aig-authorization', `Bearer ${cfAigToken}`);

    // 2. Add Backend Authentication Header (extracted from client)
    // Note: We pass the value exactly as received from the client.
    // If the backend expects a prefix (like 'Bearer ') and the client sent it, it will be included.
    // If the client *didn't* send the prefix but it's required, this might fail unless the client corrects their request.
    // Alternatively, you could add logic here to prepend providerConfig.backendAuthPrefix if it's missing, but that's usually the client's responsibility.
    forwardHeaders.set(backendAuthHeaderName, backendAuthHeaderValue);

    // 3. Set Content-Type
    forwardHeaders.set('Content-Type', request.headers.get('Content-Type') || 'application/json');

    // 4. Add other provider-specific NON-AUTH headers
    if (providerKey === 'anthropic') {
        forwardHeaders.set('anthropic-version', request.headers.get('anthropic-version') || '2023-06-01');
    }
    // Add others for OpenAI/Google if needed

    // --- Build Fetch Options ---
    const fetchOptions: RequestInit = {
      method: request.method,
      headers: forwardHeaders, // Use the constructed Headers object
      body: bodyString,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    };


    // --- Execute Forward and Handle Response ---
    try {
      childLogger.info({ model: requestBody?.model, stream: isStreamRequest }, `Forwarding request to ${providerKey} gateway`);
      const response = await fetch(targetUrl, fetchOptions);
      const duration = Date.now() - requestStart;

      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*'); // Set CORS for actual response

      // --- Streaming Response ---
      if (isStreamRequest && response.ok && response.body) { /* ... streaming handling ... */ }

      // --- Non-Streaming Response ---
      const responseBodyText = await response.text();
      if (!responseHeaders.has('Content-Type')) { responseHeaders.set('Content-Type', 'application/json'); }

      if (!response.ok) { /* ... error handling ... */ }

      // --- Successful Response & Optional Format Conversion ---
      childLogger.info({ status: response.status, duration }, `Received successful response from ${providerKey} gateway`);
      let responseData: any;
       try { responseData = JSON.parse(responseBodyText); } catch (error: any) { /* ... JSON parse error handling ... */ }

      // Anthropic -> OpenAI Conversion (Conditional)
      const useOpenAIFormat = request.headers.get('x-use-openai-format') === 'true';
      if (providerKey === 'anthropic' && useOpenAIFormat && remainingPath.includes('/messages') && !isStreamRequest) { /* ... transformation ... */ }

      // --- Return Original Provider Response ---
      return new Response(responseBodyText, { status: 200, headers: responseHeaders });

    } catch (error: any) { /* ... Fetch error handling (timeout, network) ... */ }
  },
  // --- Global Error Handler ---
  error(error: Error): Response { /* ... global error handling ... */ }
});