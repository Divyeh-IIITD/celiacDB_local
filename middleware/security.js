// middleware/security.js
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const validator = require("validator");
const multer = require("multer");
const path = require("path");

// Rate limiting for docking submissions
const dockingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 docking requests per windowMs, as of now changed to 50 from 5
  message: {
    error: "Too many docking requests from this IP, please try again later.",
    retryAfter: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for localhost in development
    return req.ip === "127.0.0.1";
  },
});

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  try {
    // Sanitize all string inputs
    for (const key in req.body) {
      if (typeof req.body[key] === "string") {
        // Remove potential XSS but preserve basic characters
        req.body[key] = validator.escape(req.body[key]);
        // Trim whitespace
        req.body[key] = req.body[key].trim();
      }
    }
    next();
  } catch (error) {
    console.error("Sanitization error:", error);
    res.status(400).json({ error: "Invalid input format" });
  }
};

// Enhanced secure file upload configuration
const upload = multer({
  dest: path.join(__dirname, "../temp_uploads"),
  limits: {
    fileSize: 16000 * 1024, // 16000KB max
    files: 2, // Allow peptide file + optional config file
    fieldSize: 1024 * 64, // 64KB field size limit
    fields: 15, // Max 15 fields
    parts: 20, // Limit total parts to prevent zip bombs
  },
  fileFilter: (req, file, cb) => {
    try {
      console.log(
        `🔍 File upload attempt: ${file.originalname} (${file.mimetype}) from IP: ${req.ip}`
      );

      // UPDATED: .txt, .pdb, and .conf files allowed
      const allowedMimeTypes = [
        "text/plain", // .txt and .conf files
        "chemical/x-pdb", // .pdb files
        "application/x-pdb", // Alternative .pdb MIME type
      ];

      const allowedExtensions = [".txt", ".pdb", ".conf", ".cfg"]; // Allow text and HADDOCK config files

      const ext = path.extname(file.originalname).toLowerCase();

      // ENHANCED: Check file name for malicious patterns
      const suspiciousPatterns = [
        /\.\./, // Directory traversal
        /[\/\\]/, // Path separators
        /[\0\|\;\&\$\`\<\>]/, // Null bytes and command injection chars
        /\.exe$|\.bat$|\.cmd$|\.com$|\.pif$|\.scr$|\.js$|\.jar$|\.sh$/i, // Executable extensions
        /\.php$|\.asp$|\.jsp$|\.py$/i, // Script extensions
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i, // Windows reserved names
      ];

      for (const pattern of suspiciousPatterns) {
        if (pattern.test(file.originalname)) {
          console.warn(
            `🚨 Suspicious filename pattern: ${file.originalname} from IP: ${req.ip}`
          );
          return cb(
            new Error("Invalid filename - contains suspicious characters")
          );
        }
      }

      // Check filename length
      if (file.originalname.length > 100) {
        console.warn(
          `🚨 Filename too long: ${file.originalname.length} chars from IP: ${req.ip}`
        );
        return cb(new Error("Filename too long (max 100 characters)"));
      }

      // Validate extension
      if (!allowedExtensions.includes(ext)) {
        console.warn(`🚨 Invalid extension: ${ext} from IP: ${req.ip}`);
        return cb(
          new Error("Invalid file type. Only .pdb, .conf, and .txt files are allowed.")
        );
      }

      // RELAXED: Allow common MIME types for better compatibility
      const acceptableMimeTypes = [
        ...allowedMimeTypes,
        "text/x-pdb",
        "text/plain",
        "application/octet-stream", // Only for .pdb files due to inconsistent MIME detection
      ];

      if (!acceptableMimeTypes.includes(file.mimetype)) {
        // Special case: Allow octet-stream only for .pdb files
        if (!(file.mimetype === "application/octet-stream" && ext === ".pdb")) {
          console.warn(
            `🚨 Invalid MIME type: ${file.mimetype} for ${ext} from IP: ${req.ip}`
          );
          return cb(
            new Error(
              `Invalid file type. Expected text or PDB file, got: ${file.mimetype}`
            )
          );
        }
      }

      console.log(
        `✅ File validation passed: ${file.originalname} from IP: ${req.ip}`
      );
      cb(null, true);
    } catch (error) {
      console.error(`🚨 File validation error: ${error.message}`);
      cb(new Error("File validation error"));
    }
  },
});

// Helper function to detect development environment
const isDevelopmentEnvironment = (req) => {
  // Check multiple indicators for development
  return (
    process.env.NODE_ENV === "development" ||
    req.hostname === "localhost" ||
    req.hostname === "127.0.0.1" ||
    req.hostname.startsWith("192.168.") ||
    req.hostname.startsWith("10.") ||
    // req.hostname === "celiacdb.raylab.iiitd.edu.in" ||  // ✅ Add your domain here
    req.ip === "127.0.0.1" ||
    req.ip === "::1"
  );
};

// Security headers configuration with environment-aware CSP
const securityHeaders = (req, res, next) => {
  const isDev = isDevelopmentEnvironment(req);

  console.log(
    `🔒 Security headers - Environment: ${
      isDev ? "development" : "production"
    } - Host: ${req.hostname} - IP: ${req.ip}`
  );

  const helmetConfig = {
    contentSecurityPolicy: isDev
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
              "'self'",
              "'unsafe-inline'",
              "'unsafe-eval'",
              "'unsafe-hashes'",
              "https://cdn.jsdelivr.net",
              "https://cdnjs.cloudflare.com",
              "https://www.ebi.ac.uk",
              "https://3dmol.org",
            ],
            "script-src-attr": ["'unsafe-inline'", "'unsafe-hashes'"],
            styleSrc: [
              "'self'",
              "'unsafe-inline'",
              "https://cdn.jsdelivr.net",
              "https://cdnjs.cloudflare.com",
              "https://www.ebi.ac.uk",
              "https://3dmol.org",
              "https://fonts.googleapis.com",
            ],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: [
              "'self'",
              "https://www.ebi.ac.uk",
              "https://3dmol.org",
              "https://cdn.jsdelivr.net", // Add this
              "data:",
            ],
            fontSrc: [
              "'self'",
              "https://cdn.jsdelivr.net",
              "https://cdnjs.cloudflare.com",
              "https://www.ebi.ac.uk",
              "https://3dmol.org",
              "https://fonts.gstatic.com",
            ],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            workerSrc: [
              "'self'",
              "blob:",
              "https://www.ebi.ac.uk",
              "https://3dmol.org",
            ],
            childSrc: ["'self'", "blob:"],
          },
        },
    crossOriginEmbedderPolicy: false,
  };

  helmet(helmetConfig)(req, res, next);
};

// Enhanced error handler for multer and other security middleware
const securityErrorHandler = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.warn(`File upload error: ${error.code} for IP ${req.ip}`);

    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return res.status(400).json({ error: "File too large (max 16000KB)" });
      case "LIMIT_UNEXPECTED_FILE":
        return res.status(400).json({ error: "Unexpected file field" });
      case "LIMIT_FIELD_COUNT":
        return res.status(400).json({ error: "Too many form fields" });
      case "LIMIT_FIELD_KEY":
        return res.status(400).json({ error: "Field name too long" });
      case "LIMIT_FIELD_VALUE":
        return res.status(400).json({ error: "Field value too long" });
      case "LIMIT_PART_COUNT":
        return res.status(400).json({ error: "Too many file parts" });
      default:
        return res.status(400).json({ error: "File upload error" });
    }
  }

  if (error.message && error.message.includes("Invalid file")) {
    return res.status(400).json({ error: error.message });
  }

  if (error.message && error.message.includes("Invalid filename")) {
    console.warn(
      `Suspicious filename from IP ${req.ip}: ${req.file?.originalname}`
    );
    return res.status(400).json({ error: "Invalid filename" });
  }

  if (error.message && error.message.includes("suspicious characters")) {
    console.warn(
      `Malicious filename attempt from IP ${req.ip}: ${req.file?.originalname}`
    );
    return res
      .status(400)
      .json({ error: "Invalid filename - security violation" });
  }

  // Don't expose internal errors
  console.error("Security middleware error:", error);
  res.status(500).json({ error: "Security validation failed" });
};

// Request logging middleware
// Request logging middleware
const requestLogger = (req, res, next) => {
  const timestamp = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  console.log(
    `${timestamp} - ${req.method} ${req.path} - IP: ${req.ip} - UA: ${req
      .get("User-Agent")
      ?.substring(0, 100)}`
  );
  next();
};

const dockingUpload = upload.fields([
  { name: "peptideFile", maxCount: 1 },
  { name: "configFile", maxCount: 1 },
]);

module.exports = {
  dockingLimiter,
  sanitizeInput,
  upload,
  dockingUpload,
  securityHeaders,
  securityErrorHandler,
  requestLogger,
};

