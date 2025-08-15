const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const router = Router();

// Set up storage for uploads (images and videos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadDir = 'uploads/images';
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('application/octet-stream')) uploadDir = 'uploads/videos';
    const absDir = path.join(process.cwd(), uploadDir);
    if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
    cb(null, absDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

// Multer file type validation
const imageFileFilter = (req, file, cb) => {
  console.log('Image upload mimetype:', file.mimetype);
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only image files are allowed!'), false);
};
const videoFileFilter = (req, file, cb) => {
  console.log('Video upload mimetype:', file.mimetype);
  if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('application/octet-stream')) cb(null, true);
  else cb(new Error('Only video files are allowed!'), false);
};

const uploadImage = multer({ storage, fileFilter: imageFileFilter });
const uploadVideo = multer({ storage, fileFilter: videoFileFilter });

// POST /api/upload/image - Upload an image
router.post('/image', uploadImage.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No image file uploaded' });
  res.json({ filename: req.file.filename, url: `/uploads/images/${req.file.filename}` });
});

// POST /api/upload/video - Upload a video
router.post('/video', uploadVideo.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No video file uploaded' });
  res.json({ filename: req.file.filename, url: `/uploads/videos/${req.file.filename}` });
});

module.exports = router;