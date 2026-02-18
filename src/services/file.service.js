const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

class FileService {
    constructor() {
        this.uploadDir = path.join(process.cwd(), 'uploads');
        this.ensureUploadDirectory();

        // Configure multer for file upload
        const storage = multer.diskStorage({
            destination: (req, file, cb) => {
                cb(null, this.uploadDir);
            },
            filename: (req, file, cb) => {
                const fileHash = crypto.randomBytes(16).toString('hex');
                cb(null, `${fileHash}${path.extname(file.originalname)}`);
            }
        });

        this.upload = multer({
            storage: storage,
            limits: {
                fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
            },
            fileFilter: this._fileFilter
        });
    }

    async ensureUploadDirectory() {
        try {
            await fs.access(this.uploadDir);
        } catch (error) {
            await fs.mkdir(this.uploadDir, { recursive: true });
        }
    }

    _fileFilter(req, file, cb) {
        const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime')
            .split(',');

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }

    // This method is now a general-purpose upload function
    async uploadFile(file) {
        try {
            if (!file) throw new Error('No file provided');

            // If the file has a buffer, write it to disk first
            if (file.buffer) {
                const filePath = path.join(this.uploadDir, file.filename);
                await fs.writeFile(filePath, file.buffer);
            }

            return {
                url: `/uploads/${file.filename}`,
                path: file.path || path.join(this.uploadDir, file.filename)
            };
        } catch (error) {
            console.error('File upload error:', error);
            throw new Error('Failed to upload file');
        }
    }

    async deleteFile(filePath) {
        try {
            const fullPath = path.join(process.cwd(), filePath.replace(/^\//, ''));
            await fs.unlink(fullPath);
            return true;
        } catch (error) {
            console.error('File deletion error:', error);
            throw new Error('Failed to delete file');
        }
    }

    getUploadMiddleware(fieldName, maxCount = 1) {
        return this.upload.array(fieldName, maxCount);
    }

    /**
     * Uploads a file from a Base64 string.
     * @param {string} base64String The Base64 string, with or without a Data URI prefix.
     * @param {string} mimeType The MIME type of the file (e.g., 'image/webp').
     * @param {string} originalFileName The desired filename (e.g., 'story.webp').
     * @returns {Promise<{url: string, path: string}>}
     */
    async uploadBase64File(base64String, mimeType, originalFileName) {
        // Strip the Data URI prefix if it exists, and get the actual Base64 data
        const base64Data = base64String.replace(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,/, '');

        // Convert the clean Base64 data to a buffer
        const buffer = Buffer.from(base64Data, 'base64');

        // Create a 'mock' file object that can be passed to the general uploadFile method
        const file = {
            buffer: buffer,
            mimetype: mimeType,
            // Generate a unique filename with the correct extension
            filename: `${crypto.randomBytes(16).toString('hex')}${path.extname(originalFileName)}`
        };

        return this.uploadFile(file);
    }
}

module.exports = new FileService();