from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
import base64
import asyncio
import io
import logging
from typing import List, Optional, Dict, Any
from enum import Enum
import json
import os
import traceback
from pydantic import BaseModel
import uuid
from fastapi.security import APIKeyHeader
from dotenv import load_dotenv
import requests
from requests.auth import HTTPBasicAuth

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Test Case Generator API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Key security
X_API_KEY = APIKeyHeader(name="X-API-Key")

# Enum for language mode
class LanguageMode(str, Enum):
    GHERKIN = "gherkin"
    TRADITIONAL = "traditional"

# Configuration
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY environment variable is not set")

# Helper for verifying API key if needed
async def verify_api_key(api_key: str = Depends(X_API_KEY)):
    # In production, implement proper API key verification
    # This is a placeholder
    if not api_key:
        raise HTTPException(status_code=401, detail="API Key required")
    return api_key

class ResponseStream:
    def __init__(self):
        self.buffer = io.StringIO()
        self.content_id = str(uuid.uuid4())
        
    def write(self, content):
        self.buffer.write(content)
        
    def read(self):
        self.buffer.seek(0)
        return self.buffer.read()
        
    def __iter__(self):
        for line in self.buffer.getvalue().splitlines():
            yield f"data: {line}\n\n"
        yield "data: [DONE]\n\n"

def get_gherkin_prompt(additional_info: Optional[str] = None):
    prompt = """
    You are a test automation specialist. Create Gherkin feature file test cases based on the images provided.
    The test cases should follow the Given-When-Then format and be comprehensive.
    
    Requirements:
    - Create a Feature description
    - Generate at least 3-5 Scenarios
    - Each Scenario should have clear Given, When, Then steps
    - Use appropriate tags where necessary
    - Include parameters and examples where appropriate
    - Format the output as a valid .feature file
    """
    
    if additional_info:
        prompt += f"\n\nAdditional information about the test requirements: {additional_info}"
    
    return prompt

def get_traditional_prompt(additional_info: Optional[str] = None):
    prompt = """
    You are a test automation specialist. Create traditional test cases in a tabular format based on the images provided.
    
    Requirements:
    - Present test cases in a structured format with these sections for each test case:
      - Test Case ID (e.g., TC001)
      - Description: Brief description of what the test case verifies
      - Preconditions: What must be true before executing the test
      - Steps: Numbered list of actions to perform
      - Expected Results: What should happen when steps are executed
      - Priority: High, Medium, or Low importance
    - Generate at least 5-7 comprehensive test cases
    - Include test cases for different scenarios including edge cases
    - Assign appropriate priority to each test case
    """
    
    if additional_info:
        prompt += f"\n\nAdditional information about the test requirements: {additional_info}"
    
    return prompt

async def encode_image_to_base64(file: UploadFile) -> str:
    """Convert image file to base64 string"""
    contents = await file.read()
    base64_encoded = base64.b64encode(contents).decode("utf-8")
    await file.seek(0)  # Reset file position
    return base64_encoded

async def process_request(
    images: List[UploadFile],
    language_mode: LanguageMode,
    additional_info: Optional[str] = None,
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """Generate test cases by calling OpenAI API with images and streaming the response"""
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured in environment")
    
    # Encode all images to base64
    image_contents = []
    for image in images:
        try:
            base64_image = await encode_image_to_base64(image)
            # Determine image type from filename or content type
            file_ext = image.filename.split('.')[-1].lower()
            mime_type = f"image/{file_ext}"
            if file_ext == 'jpg':
                mime_type = "image/jpeg"
                
            image_contents.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/{file_ext};base64,{base64_image}"
                }
            })
        except Exception as e:
            logger.error(f"Error processing image {image.filename}: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Error processing image: {str(e)}")
    
    # Get appropriate prompt based on language mode
    if language_mode == LanguageMode.GHERKIN:
        prompt_content = get_gherkin_prompt(additional_info)
    else:
        prompt_content = get_traditional_prompt(additional_info)
    
    # Prepare message content with text and images
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": prompt_content
                }
            ]
        }
    ]
    
    # Add image contents to the existing message
    if image_contents:
        messages[0]["content"].extend(image_contents)
    
    # Prepare API request
    try:
        # Create the completion
        print("Creating completion...")
        response = client.chat.completions.create(
            model="gpt-4.1",
            messages=messages,
            stream=True
        )
        print("Completion created successfully.")
        # Stream the response
        for chunk in response:
            if hasattr(chunk, 'choices') and chunk.choices and hasattr(chunk.choices[0], 'delta') and hasattr(chunk.choices[0].delta, 'content'):
                content = chunk.choices[0].delta.content
                if content:
                    yield f"data: {content}\n\n"

        yield "data: [DONE]\n\n"
    except Exception as e:
        logger.error(f"Error calling OpenAI API: {str(e)}")
        traceback.print_exc()
        yield f"data: Error: {str(e)}\n\n"
        yield "data: [DONE]\n\n"


@app.post("/api/generate-test-cases")
async def create_test_caases(
    images: List[UploadFile] = File(..., description="Images to analyze for test case generation"),
    language_mode: LanguageMode = Form(..., description="Language mode for test cases (gherkin or traditional)"),
    additional_info: Optional[str] = Form(None, description="Additional information or requirements")
):
    """
    Generate test cases from images in either Gherkin or traditional format.
    
    - **images**: Upload one or more image files showing the application/feature to test
    - **language_mode**: Choose between 'gherkin' or 'traditional' test case format
    - **additional_info**: Optional additional context or requirements
    
    Returns a streaming response of generated test cases.
    """
    # Validate inputs
    if not images:
        raise HTTPException(status_code=400, detail="At least one image is required")
    
    return StreamingResponse(
        process_request(images, language_mode, additional_info),
        media_type="text/event-stream"
    )



@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "version": "1.0.0"}

@app.post("/generate-excel-proxy")
async def generate_excel_proxy(content: str = Form(...)):
    try:
        # Make request to backend Excel generator
        response = requests.post(
            "https://192.168.3.90:8080/generate-excel",
            json={"result": content},
            headers={"Content-Type": "application/json"},
            verify=False  # Disable SSL verification for self-signed cert
        )
        
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail="Failed to generate Excel")
            
        # Return the Excel file
        return StreamingResponse(
            io.BytesIO(response.content),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=test_cases.xlsx"}
        )
        
    except Exception as e:
        logger.error(f"Error generating Excel: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to generate Excel file")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)