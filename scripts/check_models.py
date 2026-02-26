# check_models.py
import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    print("❌ Error: GOOGLE_API_KEY not found in .env")
    exit()

genai.configure(api_key=api_key)

print("🔎 Connecting to Google AI...")
print("Available models for you:")

try:
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(f"👉 {m.name}")
except Exception as e:
    print(f"❌ Error fetching models: {e}")
    