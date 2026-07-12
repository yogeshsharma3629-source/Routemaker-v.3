import json
import os
import webbrowser
import streamlit as st
import streamlit.components.v1 as components  # Added to host your index.html
from PIL import Image
from google import genai

# =====================================================================
# PASTE YOUR API KEY INSIDE THE QUOTES BELOW
# =====================================================================
API_KEY = "AQ.Ab8RN6KHeN6n7XZzUMwg9ym3PtLXvIbxvMD5zw2e_ig802WniA"

# Set up the webpage layout
st.set_page_config(page_title="Address Extractor", page_icon="📦")
st.title("📋 Delivery Address Extractor")
st.write(
    "Upload a photo of your delivery screen to save addresses and load your routing app."
)

# File uploader widget
uploaded_file = st.file_uploader(
    "Choose an image...", type=["png", "jpg", "jpeg"]
)

if uploaded_file is not None:
    image = Image.open(uploaded_file)
    st.image(image, caption="Uploaded Image", use_container_width=True)

    st.write("🔄 Processing with Gemini AI...")

    try:
        # Initialize Gemini
        client = genai.Client(api_key=API_KEY)

        # Prompt asking for a clean array
        prompt = """
        Extract all delivery addresses from this image. DO NOT include any client names or customer names.
        Return the data ONLY as a clean JSON array of objects, where each object has these exact keys: "street", "postal_code", "city".
        Do not wrap the JSON in markdown code blocks like ```json. Just return raw JSON text.
        """

        # Send image to the AI model
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[image, prompt],
        )

        # Parse the text to ensure it's valid JSON
        addresses_data = json.loads(response.text.strip())

        # Show the results on the webpage screen
        st.success("✨ Extracted Addresses:")
        st.json(addresses_data)

        # --- SAVE LOCALLY ---
        with open("addresses.json", "w", encoding="utf-8") as f:
            json.dump(addresses_data, f, ensure_ascii=False, indent=4)

        st.success("💾 Saved to 'addresses.json'!")

        # --- EMBED & DISPLAY YOUR ROUTING APP SAFELY ---
        st.markdown("---")
        st.subheader("🗺️ Your Routing Web App")
        st.write("Your app is now loaded below with the addresses imported:")

        # Read your index.html file directly
        with open("index.html", "r", encoding="utf-8") as html_file:
            html_content = html_file.read()

        # This injects and runs your entire HTML/JS app directly inside Streamlit safely!
        components.html(html_content, height=600, scrolling=True)

    except Exception as e:
        st.error(f"An error occurred: {e}")
