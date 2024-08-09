const fs = require('fs');
const PDFParser = require('pdf-parse');
const tesseract = require('tesseract.js');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Initialize the Google Generative AI with the API key from the environment variable
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

async function extractTextFromPdf(pdfPath) {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await PDFParser(dataBuffer);
    return data.text;
}

async function extractTextFromImage(imagePath) {
    const { data: { text } } = await tesseract.recognize(imagePath, 'eng');
    return text;
}

async function extractInvoiceDetails(text) {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
    Extract the following details from the invoice text:
    - Customer details
    - Products
    - Total Amount

    Format the output as a JSON object with the following structure:
    {
        "customer_details": {
            "name": "...",
            "address": "..."
        },
        "products": [
            {
                "description": "...",
                "quantity": ...,
                "total": ...
            },
            ...
        ],
        "total_amount": "..."
    }

    Important: Provide only the JSON object without any additional formatting or markdown.

    Invoice text:
    ${text}
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let textResponse = response.text();
        
        // Remove any markdown formatting
        textResponse = textResponse.replace(/```json\n?|\n?```/g, '').trim();
        
        // Parse the cleaned text response as JSON
        try {
            return JSON.parse(textResponse);
        } catch (parseError) {
            console.error('Error parsing JSON response:', parseError);
            return {
                error: 'Failed to parse JSON response from Gemini API.',
                raw_response: textResponse
            };
        }
    } catch (error) {
        console.error('Error generating content from Gemini API:', error);
        return {
            error: 'Failed to extract invoice details using Gemini API.',
            raw_response: error.message
        };
    }
}

async function processInvoice(filePath) {
    const fileExtension = path.extname(filePath).toLowerCase();
    try {
        let text;
        if (fileExtension === '.pdf') {
            text = await extractTextFromPdf(filePath);
        } else if (['.png', '.jpg', '.jpeg'].includes(fileExtension)) {
            text = await extractTextFromImage(filePath);
        } else {
            throw new Error('Unsupported file type');
        }

        const details = await extractInvoiceDetails(text);
        return details;
    } catch (error) {
        return {
            error: `Failed to process invoice: ${error.message}`,
            file_path: filePath
        };
    }
}

module.exports = {
    processInvoice
};
