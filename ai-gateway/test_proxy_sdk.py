import os
import sys
import time
import openai
import anthropic
from dotenv import load_dotenv # Import the function

# --- Load Environment Variables ---
# Load variables from .env file into environment variables
# This should be called BEFORE accessing os.getenv
load_dotenv()

# --- Configuration ---
# Load API keys from environment variables (now populated by load_dotenv)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
# GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") # Uncomment if testing Google

# Proxy server URL (running locally)
PROXY_URL = "http://localhost:9000"

# --- Helper Function ---
def check_env_vars():
    """Checks if required API key environment variables are set (after dotenv load)."""
    missing_vars = []
    # Check the variables loaded by os.getenv
    if not ANTHROPIC_API_KEY:
        missing_vars.append("ANTHROPIC_API_KEY")
    if not OPENAI_API_KEY:
        missing_vars.append("OPENAI_API_KEY")
    # if not GOOGLE_API_KEY: # Uncomment if testing Google
    #     missing_vars.append("GOOGLE_API_KEY")

    if missing_vars:
        print(f"ERROR: Missing required API keys in .env file or environment: {', '.join(missing_vars)}")
        print("Please ensure they are defined in the .env file in the same directory as the script.")
        sys.exit(1) # Exit if keys are missing

# --- Test Functions using SDKs (No changes needed inside these functions) ---

def test_anthropic_sdk():
    """Tests the Anthropic endpoint via proxy using the Anthropic SDK."""
    print(">>> Testing Anthropic SDK via Proxy")
    if not ANTHROPIC_API_KEY:
        print("--- Skipping Anthropic SDK test (ANTHROPIC_API_KEY not found) ---")
        return

    try:
        client = anthropic.Anthropic(
            api_key=ANTHROPIC_API_KEY,
            base_url=f"{PROXY_URL}/anthropic",
        )
        print("Sending request to Anthropic via proxy...")
        message = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=50,
            messages=[{"role": "user", "content": "Briefly, what is Cloudflare using the SDK?"}]
        )
        print("--- Anthropic SDK Response ---")
        print(f"Status: Success")
        if message.content and isinstance(message.content, list): print(f"Content: {message.content[0].text}")
        else: print(f"Raw Response: {message}")
        print(f"Stop Reason: {message.stop_reason}")
        print(f"Model Used: {message.model}")
        print("--- End Anthropic SDK Response ---")
    # ... (rest of the error handling remains the same) ...
    except anthropic.APIConnectionError as e: print(f"Anthropic SDK ERROR: Connection error: {e.__cause__}")
    except anthropic.RateLimitError as e: print(f"Anthropic SDK ERROR: Rate limit exceeded: {e}")
    except anthropic.AuthenticationError as e: print(f"Anthropic SDK ERROR: Authentication failed (Check API Key?): {e}")
    except anthropic.APIStatusError as e: print(f"Anthropic SDK ERROR: API returned an error status:\n  Status Code: {e.status_code}\n  Response: {e.response.text}")
    except Exception as e: print(f"Anthropic SDK ERROR: An unexpected error occurred: {e}")
    finally:
        print("-" * 30)
        time.sleep(1)


def test_openai_sdk():
    """Tests the OpenAI endpoint via proxy using the OpenAI SDK."""
    print(">>> Testing OpenAI SDK via Proxy")
    if not OPENAI_API_KEY:
        print("--- Skipping OpenAI SDK test (OPENAI_API_KEY not found) ---")
        return

    try:
        client = openai.OpenAI(
            api_key=OPENAI_API_KEY,
            base_url=f"{PROXY_URL}/openai/v1",
        )
        print("Sending request to OpenAI via proxy...")
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=250,
            messages=[{"role": "user", "content": "Briefly, what is Cloudflare using the SDK?"}]
        )
        print("--- OpenAI SDK Response ---")
        print(f"Status: Success")
        if completion.choices: print(f"Content: {completion.choices[0].message.content}")
        else: print("No choices found in response.")
        print(f"Finish Reason: {completion.choices[0].finish_reason}")
        print(f"Model Used: {completion.model}")
        print("--- End OpenAI SDK Response ---")
    # ... (rest of the error handling remains the same) ...
    except openai.APIConnectionError as e: print(f"OpenAI SDK ERROR: Connection error: {e.__cause__}")
    except openai.RateLimitError as e: print(f"OpenAI SDK ERROR: Rate limit exceeded: {e}")
    except openai.AuthenticationError as e: print(f"OpenAI SDK ERROR: Authentication failed (Check API Key?): {e}")
    except openai.APIStatusError as e: print(f"OpenAI SDK ERROR: API returned an error status:\n  Status Code: {e.status_code}\n  Response: {e.response.text}")
    except Exception as e: print(f"OpenAI SDK ERROR: An unexpected error occurred: {e}")
    finally:
        print("-" * 30)
        time.sleep(1)


def test_openai_streaming_sdk():
    """Tests the OpenAI streaming endpoint via proxy using the OpenAI SDK."""
    print(">>> Testing OpenAI SDK Streaming via Proxy")
    if not OPENAI_API_KEY:
        print("--- Skipping OpenAI Streaming SDK test (OPENAI_API_KEY not found) ---")
        return

    try:
        client = openai.OpenAI(
            api_key=OPENAI_API_KEY,
            base_url=f"{PROXY_URL}/openai/v1",
        )
        print("Sending streaming request to OpenAI via proxy...")
        stream = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=300,
            messages=[{"role": "user", "content": "Tell me a very short story about a proxy server using the SDK."}],
            stream=True,
        )
        print("--- OpenAI SDK Streaming Response ---")
        print("Streaming Content:")
        full_response = ""
        for chunk in stream:
            content = chunk.choices[0].delta.content
            if content is not None:
                print(content, end='', flush=True)
                full_response += content
        print("\n--- End OpenAI SDK Streaming ---")
    # ... (rest of the error handling remains the same) ...
    except openai.APIConnectionError as e: print(f"\nOpenAI SDK STREAMING ERROR: Connection error: {e.__cause__}")
    except openai.RateLimitError as e: print(f"\nOpenAI SDK STREAMING ERROR: Rate limit exceeded: {e}")
    except openai.AuthenticationError as e: print(f"\nOpenAI SDK STREAMING ERROR: Authentication failed (Check API Key?): {e}")
    except openai.APIStatusError as e: print(f"\nOpenAI SDK STREAMING ERROR: API returned an error status:\n  Status Code: {e.status_code}\n  Response: {e.response.text}")
    except Exception as e: print(f"\nOpenAI SDK STREAMING ERROR: An unexpected error occurred: {e}")
    finally:
        print("-" * 30)
        time.sleep(1)

# --- Main Execution ---
if __name__ == "__main__":
    print("--- Starting Python SDK Proxy Tests ---")
    print(f"Proxy URL Base: {PROXY_URL}")
    print("(Loading API keys from .env file)")
    print("(Ensure the proxy server is running and configured)")
    print("-" * 30)

    check_env_vars() # Check if keys were loaded successfully

    test_anthropic_sdk()
    test_openai_sdk()
    test_openai_streaming_sdk()
    # Add test_google_sdk() here if needed

    print("--- All Python SDK Tests Completed ---")
