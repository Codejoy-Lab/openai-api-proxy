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
    let requestBody: any;
    let bodyString: string | undefined;
    let isStreamRequest = false;
    try { /* ... body processing logic ... */
         if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
            const contentType = request.headers.get('content-type');
            if (contentType?.includes('application/json')) {
                requestBody = await request.json();
                isStreamRequest = requestBody?.stream === true;
                const { moderation, moderation_level, ...restBody } = requestBody; // Clean fields if necessary

                // Provider-Specific Body Adjustments (e.g., Anthropic defaults)
                if (providerKey === 'anthropic' && remainingPath.includes('/messages')) {
                    bodyString = JSON.stringify({ ...restBody, model: restBody.model || 'claude-3-sonnet-20240229', max_tokens: restBody.max_tokens || 1024 });
                } else {
                    bodyString = JSON.stringify(restBody); // Pass through by default
                }
            } else if (request.body) {
                 childLogger.warn({ contentType }, "Received non-JSON request body, attempting to read as text");
                 bodyString = await request.text();
                 isStreamRequest = false;
            }
        }
    } catch (error: any) { /* ... body parsing error handling ... */ }

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