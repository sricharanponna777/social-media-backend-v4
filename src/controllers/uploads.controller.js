class UploadsController {
    static async uploadImage(req, res) {
        if (!req.file) return res.status(400).json({ message: 'No image file uploaded' });
        res.json({ filename: req.file.filename, url: `/uploads/images/${req.file.filename}` });
    }
    static async uploadVideo(req, res) {
        if (!req.file) return res.status(400).json({ message: 'No video file uploaded' });
        res.json({ filename: req.file.filename, url: `/uploads/videos/${req.file.filename}` });
    }
}

module.exports = UploadsController