const express = require('express');
const fileUpload = require('express-fileupload');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { processInvoice } = require('./invoiceProcessor');

const app = express();
const UPLOAD_FOLDER = path.join(__dirname, 'uploads');

app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5173', 'https://your-production-backend.com'], 
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
app.use(fileUpload());
app.use(express.json());

if (!fs.existsSync(UPLOAD_FOLDER)) {
    fs.mkdirSync(UPLOAD_FOLDER);
}

app.post('/process-invoice', async (req, res) => {
    if (!req.files || !req.files.invoice) {
        return res.status(400).json({ error: 'No file part' });
    }

    const file = req.files.invoice;
    const filename = path.basename(file.name);
    const filepath = path.join(UPLOAD_FOLDER, filename);

    try {
        // Save the uploaded file
        await file.mv(filepath);

        // Process the invoice
        const result = await processInvoice(filepath);

        // Clean up the uploaded file
        fs.unlinkSync(filepath);

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: `Failed to process invoice: ${err.message}` });
    }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
