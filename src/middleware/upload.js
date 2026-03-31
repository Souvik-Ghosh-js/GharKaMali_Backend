const multer = require('multer');
const path = require('path');
const fs = require('fs');

const createStorage = (folder) => multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.env.UPLOAD_PATH || './uploads', folder);
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});

const imageFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) cb(null, true);
  else cb(new Error('Only image files are allowed'));
};

const uploadProfile = multer({ storage: createStorage('profiles'), fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadWorkProof = multer({ storage: createStorage('work-proof'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadPlant = multer({ storage: createStorage('plants'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadBlog = multer({ storage: createStorage('blogs'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadIdProof = multer({ storage: createStorage('id-proofs'), fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadShop = multer({ storage: createStorage('shop'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });

module.exports = { uploadProfile, uploadWorkProof, uploadPlant, uploadIdProof, uploadBlog, uploadShop };
