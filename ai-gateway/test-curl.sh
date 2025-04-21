#!/bin/bash

# --- Configuration ---
# !! IMPORTANT: Replace placeholders with your ACTUAL backend API keys !!
# ANTHROPIC_API_KEY="sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
# OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
# GOOGLE_API_KEY="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" # Google AI Studio / MakerSuite Key
source ./.env
# Proxy server URL (running locally)
PROXY_URL="http://localhost:9000"

# --- Helper Function ---
check_key() {
  local key_name="$1"
  local key_value="$2"
  local placeholder_pattern="YOUR_.*_HERE|sk-ant-xxx*|sk-xxx*|xxx*" # Add more patterns if needed

  # Check if the key value matches any known placeholder patterns
  if [[ "$key_value" =~ $placeholder_pattern || -z "$key_value" ]]; then
    echo "ERROR: Please replace the placeholder for $key_name in the script."
    exit 1
  fi
}

# --- Pre-flight Checks ---
# check_key "ANTHROPIC_API_KEY" "$ANTHROPIC_API_KEY"
# check_key "OPENAI_API_KEY" "$OPENAI_API_KEY"
# check_key "GOOGLE_API_KEY" "$GOOGLE_API_KEY"

echo "--- Starting Proxy Tests ---"
echo "Proxy URL: $PROXY_URL"
echo "(Ensure the proxy server is running and configured with CF_API_TOKEN and CF_GATEWAY_URL_*)"
echo ""

# --- Test 1: Anthropic ---
echo "--- Testing Anthropic (/anthropic/v1/messages) ---"
curl --request POST \
  --url "$PROXY_URL/anthropic/v1/messages" \
  --header "Content-Type: application/json" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --data '{
    "model": "claude-3-haiku-20240307", # Use a cheaper/faster model for testing if possible
    "max_tokens": 50,
    "messages": [
      {"role": "user", "content": "Briefly, what is Cloudflare?"}
    ]
  }'
echo "" # Newline for readability
echo "--- Anthropic Test Done ---"
echo ""
sleep 1 # Small delay between tests

# --- Test 2: OpenAI ---
echo "--- Testing OpenAI (/openai/v1/chat/completions) ---"
curl --request POST \
  --url "$PROXY_URL/openai/v1/chat/completions" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer $OPENAI_API_KEY" \
  --data '{
    "model": "gpt-4o-mini", # Use a cheaper/faster model for testing
    "max_tokens": 250,
    "messages": [
      {"role": "user", "content": "Briefly, what is Cloudflare?"}
    ]
  }'
echo "" # Newline
echo "--- OpenAI Test Done ---"
echo ""
sleep 1

# --- Test 3: Google AI Studio (Gemini) ---
# Note: Adjust the model name and API path if needed
# Using gemini-1.5-flash as a potentially faster/cheaper option
# GEMINI_MODEL="gemini-1.5-flash-latest"
# GEMINI_API_PATH="/google-ai-studio/v1beta/models/$GEMINI_MODEL:generateContent"

# echo "--- Testing Google AI Studio ($GEMINI_API_PATH) ---"
# curl --request POST \
#   --url "$PROXY_URL$GEMINI_API_PATH" \
#   --header "Content-Type: application/json" \
#   --header "x-goog-api-key: $GOOGLE_API_KEY" \
#   --data '{
#     "contents": [
#       {
#         "role":"user",
#         "parts": [
#           {"text":"Briefly, what is Cloudflare?"}
#         ]
#       }
#     ],
#     "generationConfig": {
#         "maxOutputTokens": 50
#     }
#   }'
# echo "" # Newline
# echo "--- Google AI Studio Test Done ---"
# echo ""


# --- Optional Test 4: OpenAI Streaming ---
echo "--- Testing OpenAI Streaming (/openai/v1/chat/completions) ---"
curl --request POST \
  --url "$PROXY_URL/openai/v1/chat/completions" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer $OPENAI_API_KEY" \
  --no-buffer \
  --data '{
    "model": "gpt-4o-mini",
    "max_tokens": 300,
    "messages": [
      {"role": "user", "content": "Tell me a very short story about a proxy server."}
    ],
    "stream": true
  }'
echo "" # Newline
echo "--- OpenAI Streaming Test Done ---"
echo ""


echo "--- All Tests Completed ---"