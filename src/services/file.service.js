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
        const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif')
            .split(',');

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }

    async uploadFile(file) {
        try {
            if (!file) throw new Error('No file provided');

            // File is already saved by multer, just return the URL
            return {
                url: `/uploads/${file.filename}`,
                path: file.path
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

    // Utility method to get file type from base64
    getFileTypeFromBase64(base64String) {
        const match = base64String.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,/);
        return match ? match[1] : null;
    }

    // Convert base64 to buffer
    base64ToBuffer(base64String) {
        const base64Data = base64String.replace(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,/, '');
        return Buffer.from(base64Data, 'base64');
    }

    // Upload base64 file
    async uploadBase64File(base64String, fileName) {
        const fileType = this.getFileTypeFromBase64(base64String);
        if (!fileType) {
            throw new Error('Invalid base64 string');
        }

        const buffer = this.base64ToBuffer(base64String);
        const file = {
            buffer,
            mimetype: fileType,
            originalname: fileName
        };

        return this.uploadFile(file);
    }
}

module.exports = new FileService();
