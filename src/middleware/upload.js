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
  const allowedExts = /jpeg|jpg|png|webp|heic|heif|jfif|bmp/;
  const ext = allowedExts.test(path.extname(file.originalname).toLowerCase());
  const mime = file.mimetype.startsWith('image/') || allowedExts.test(file.mimetype);
  
  if (ext || mime) {
    cb(null, true);
  } else {
    console.log(`❌ Upload rejected: Name=${file.originalname}, Mime=${file.mimetype}`);
    cb(new Error('Only image files are allowed (jpg, png, webp, heic supported)'));
  }
};

const uploadProfile = multer({ storage: createStorage('profiles'), fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadWorkProof = multer({ storage: createStorage('work-proof'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadPlant = multer({ storage: createStorage('plants'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadBlog = multer({ storage: createStorage('blogs'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadIdProof = multer({ storage: createStorage('id-proofs'), fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadShop = multer({ storage: createStorage('shop'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadDocument = multer({ storage: createStorage('documents'), fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } });

const complaintFilter = (req, file, cb) => {
  const allowedExts = /jpeg|jpg|png|webp|heic|heif|jfif|bmp|pdf|doc|docx|xls|xlsx|csv|txt/;
  const ext = allowedExts.test(path.extname(file.originalname).toLowerCase());
  const mime = file.mimetype.startsWith('image/')
    || file.mimetype.includes('pdf')
    || file.mimetype.includes('word')
    || file.mimetype.includes('excel')
    || file.mimetype.includes('spreadsheet')
    || file.mimetype.includes('text');
  if (ext || mime) cb(null, true);
  else cb(new Error('Only images, PDFs, Office docs and text files are allowed'));
};
const uploadComplaint = multer({
  storage: createStorage('complaints'),
  fileFilter: complaintFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
});

module.exports = { uploadProfile, uploadWorkProof, uploadPlant, uploadIdProof, uploadBlog, uploadShop, uploadDocument, uploadComplaint };
