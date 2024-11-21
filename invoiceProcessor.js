const fs = require('fs');
const PDFParser = require('pdf-parse');
const tesseract = require('tesseract.js');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const XLSX = require('xlsx');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

async function extractTextFromPdf(pdfPath) {
    try {
        const dataBuffer = fs.readFileSync(pdfPath);
        const data = await PDFParser(dataBuffer);
        return data.text || '';
    } catch (error) {
        console.error('PDF parsing error:', error);
        return '';
    }
}

async function extractTextFromImage(imagePath) {
    try {
        const { data: { text } } = await tesseract.recognize(imagePath, 'eng');
        return text || '';
    } catch (error) {
        console.error('Image text extraction error:', error);
        return '';
    }
}

async function extractDataFromExcel(filePath) {
    try {
        const workbook = XLSX.readFile(filePath); 
        const sheetNames = workbook.SheetNames; 
        const sheet = workbook.Sheets[sheetNames[0]]; 
        const jsonData = XLSX.utils.sheet_to_json(sheet); 

        const invoices = [];
        const products = [];
        const customers = new Map(); 

        jsonData.forEach(row => {
            const invoice = {
                serialNumber: row['Serial Number'] || 'N/A',
                customerName: row['Customer Name'] || 'N/A',
                productName: row['Product Name'] || 'N/A',
                quantity: row['Quantity'] || 0,
                tax: row['Tax'] || 0,
                totalAmount: row['Total Amount'] || 0,
                date: row['Date'] || 'N/A'
            };
            invoices.push(invoice);

            const product = {
                name: row['Product Name'] || 'N/A',
                quantity: row['Quantity'] || 0,
                unitPrice: row['Unit Price'] || 0,
                tax: row['Tax'] || 0,
                priceWithTax: row['Price with Tax'] || 0,
                discount: row['Discount'] || 'N/A'
            };
            products.push(product);

            // Aggregate customer data
            const customerName = row['Customer Name'] || 'N/A';
            const totalPurchaseAmount = row['Total Amount'] || 0;
            if (customers.has(customerName)) {
                customers.set(customerName, customers.get(customerName) + totalPurchaseAmount);
            } else {
                customers.set(customerName, totalPurchaseAmount);
            }
        });

        const customerArray = Array.from(customers.entries()).map(([name, totalPurchaseAmount]) => ({
            name,
            phoneNumber: 'N/A', 
            totalPurchaseAmount
        }));

        return {
            invoices,
            products,
            customers: customerArray
        };
    } catch (error) {
        console.error('Excel data extraction error:', error);
        throw new Error('Failed to extract data from Excel file.');
    }
}


async function extractInvoiceDetails(text) {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
    Comprehensively Extract Invoice Details:
    - Strictly follow this JSON structure
    - If any field is not found, use 'N/A' or 0
    - Analyze the text carefully and extract maximum possible details

    Required JSON Structure:
    {
        "customer_details": {
            "name": "Customer Full Name",
            "address": "Complete Address",
            "phone": "Phone Number (if available)"
        },
        "products": [
            {
                "description": "Product Name/Description",
                "quantity": number,
                "unit_price": number,
                "total": number
            }
        ],
        "total_amount": number,
        "tax_amount": number,
        "invoice_date": "Date of Invoice",
        "invoice_number": "Invoice Serial Number"
    }

    Here's the invoice text to extract details from:
    ${text}
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let textResponse = response.text();
        
        textResponse = textResponse.replace(/```json\n?|\n?```/g, '').trim();
        
        try {
            const parsedData = JSON.parse(textResponse);
            
            const cleanedData = {
                customer_details: {
                    name: parsedData.customer_details?.name || 'N/A',
                    address: parsedData.customer_details?.address || 'N/A',
                    phone: parsedData.customer_details?.phone || 'N/A'
                },
                products: (parsedData.products || []).map(product => ({
                    description: product.description || 'N/A',
                    quantity: Number(product.quantity) || 0,
                    unit_price: Number(product.unit_price) || 0,
                    total: Number(product.total) || 0
                })),
                total_amount: Number(parsedData.total_amount) || 0,
                tax_amount: Number(parsedData.tax_amount) || 0,
                invoice_date: parsedData.invoice_date || 'N/A',
                invoice_number: parsedData.invoice_number || 'N/A'
            };

            return {
                invoices: [{
                    serialNumber: cleanedData.invoice_number,
                    customerName: cleanedData.customer_details.name,
                    productName: cleanedData.products[0]?.description || 'N/A',
                    quantity: cleanedData.products[0]?.quantity || 0,
                    tax: cleanedData.tax_amount,
                    totalAmount: cleanedData.total_amount,
                    date: cleanedData.invoice_date
                }],
                products: cleanedData.products.map(product => ({
                    name: product.description,
                    quantity: product.quantity,
                    unitPrice: product.unit_price,
                    tax: cleanedData.tax_amount,
                    priceWithTax: product.total,
                    discount: 'N/A'
                })),
                customers: [{
                    name: cleanedData.customer_details.name,
                    phoneNumber: cleanedData.customer_details.phone,
                    totalPurchaseAmount: cleanedData.total_amount
                }]
            };
        } catch (parseError) {
            console.error('Error parsing JSON response:', parseError);
            return {
                error: 'Failed to parse detailed invoice information.',
                raw_response: textResponse
            };
        }
    } catch (error) {
        console.error('Error generating content from Gemini API:', error);
        return {
            error: 'Advanced AI extraction failed. Please check the file quality.',
            raw_response: error.message
        };
    }
}

async function processInvoice(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    let extractedData;

    try {
        if (ext === '.pdf') {
            const text = await extractTextFromPdf(filePath);
            extractedData = await extractInvoiceDetails(text);
        } else if (ext === '.jpg' || ext === '.png') {
            const text = await extractTextFromImage(filePath);
            extractedData = await extractInvoiceDetails(text);
        } else if (ext === '.xlsx' || ext === '.xls') {
            extractedData = await extractDataFromExcel(filePath);
        } else {
            throw new Error('Unsupported file type');
        }

        if (extractedData.error) {
            throw new Error(extractedData.error);
        }

        return extractedData;
    } catch (err) {
        console.error('Invoice Processing Error:', err);
        return {
            error: `Invoice Processing Failed: ${err.message}. 
            Possible reasons:
            - Unclear or low-quality document
            - Unsupported document format
            - Extraction limitations`,
            details: err.toString()
        };
    }
}

module.exports = {
    processInvoice
};