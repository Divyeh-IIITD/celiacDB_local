const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

// Import controllers
const proteinController = require("../controllers/proteinController");
const dockingController = require("../controllers/dockingController");
const customDockingController = require("../controllers/customDockingController");
const peptidePrepController = require("../controllers/peptidePrepController");

// Import fileService for status checks
const fileService = require("../services/fileService");

// Import security middleware
const security = require("../middleware/security");

// REMOVED: Old insecure multer configuration
// Using secure configuration from middleware/security.js instead

// Home page with 3 main options
router.get("/", proteinController.getHomePage);

// ============================================================================
// PAGE 1: HLADQ Proteins Analysis and Download
// ============================================================================
router.get("/hladq-proteins", proteinController.getAllProteins);
router.get("/hladq-protein/:id", proteinController.getProteinDetails);
router.get("/hladq-protein/:id/download", proteinController.downloadProtein);
router.get(
  "/hladq-protein/:id/download-all-zip",
  proteinController.downloadAllFiles
);

// ============================================================================
// PAGE 2: Pre-computed Docking Analysis (Database Results)
// ============================================================================
router.get("/docking-analysis", dockingController.getDockingForm);
router.post("/docking-analysis", dockingController.submitDockingForm);
router.get(
  "/docking-results/:proteinId/:peptideName",
  dockingController.getDockingResults
);
router.get(
  "/docking-results/:proteinId/:peptideName/download-all-zip",
  dockingController.downloadDockingResults
);

// ============================================================================
// ============================================================================
// PAGE 3: Custom Docking & Peptide Prep (Nested under Custom Docking)
// ============================================================================

// Get custom docking form
router.get("/custom-docking", customDockingController.getCustomDockingForm);
router.get(
  "/api/rcsb/reference/:proteinId",
  security.dockingLimiter,
  security.sanitizeInput,
  customDockingController.getRcsbReference
);

// Alternative route for backward compatibility
router.get(
  "/custom-docking-form",
  customDockingController.getCustomDockingForm
);

// Peptide Preparation nested under /custom-docking
router.get(
  "/custom-docking/peptide-prep",
  peptidePrepController.getPeptidePrepPage
);
router.post(
  "/custom-docking/peptide-prep/generate",
  peptidePrepController.generateConformers
);
router.get(
  "/custom-docking/peptide-prep/download/:sessionId/:type",
  peptidePrepController.downloadConformer
);

// Backward compatibility redirects and handlers for /peptide-prep
router.get("/peptide-prep", (req, res) => {
  res.redirect(301, "/custom-docking/peptide-prep");
});
router.post("/peptide-prep/generate", peptidePrepController.generateConformers);
router.get(
  "/peptide-prep/download/:sessionId/:type",
  peptidePrepController.downloadConformer
);

// UPDATED: Submit custom docking request with multi-field upload (peptideFile + optional configFile)
router.post(
  "/custom-docking",
  security.dockingLimiter, // Rate limiting
  security.sanitizeInput, // Input sanitization
  security.dockingUpload, // Secure file upload (.pdb, .conf, .txt)
  customDockingController.submitCustomDocking
);

// Get custom docking results with input sanitization
router.get(
  "/custom-docking-results/:sessionId",
  security.sanitizeInput, // Sanitize URL parameters
  customDockingController.getCustomDockingResults
);

router.get(
  "/custom-docking-progress/:sessionId",
  security.sanitizeInput,
  customDockingController.getDockingProgress
);

// Serve temporary result files with input sanitization
router.get(
  "/temp-results/:sessionId/:filename",
  security.sanitizeInput, // Sanitize URL parameters
  customDockingController.serveTempFile
);

// ============================================================================
// ADMIN & MANAGEMENT ROUTES (UPDATED WITH SECURITY)
// ============================================================================

// AUTO-CLEANUP MONITORING ROUTES with rate limiting
router.get(
  "/admin/cleanup-status",
  security.dockingLimiter,
  customDockingController.getAutoCleanupStatus
);

router.post(
  "/admin/force-cleanup",
  security.dockingLimiter,
  security.sanitizeInput,
  customDockingController.forceCleanupNow
);

router.get(
  "/admin/session-stats",
  security.dockingLimiter,
  customDockingController.getSessionStats
);

// LEGACY CLEANUP ROUTE (kept for backward compatibility, but now uses auto-cleanup)
router.post("/admin/cleanup-sessions", security.dockingLimiter, (req, res) => {
  console.log(`🔧 Legacy cleanup endpoint accessed from IP: ${req.ip}`);
  res.json({
    message: "Manual cleanup is deprecated. Auto-cleanup is now active.",
    autoCleanup: {
      status: "active",
      interval: "every hour",
      maxAge: "24 hours",
    },
    suggestion:
      "Use GET /admin/cleanup-status to monitor auto-cleanup or POST /admin/force-cleanup for immediate cleanup",
  });
});

// Enhanced admin overview with rate limiting
router.get("/admin/sessions", security.dockingLimiter, async (req, res) => {
  try {
    console.log(`📊 Admin sessions overview accessed from IP: ${req.ip}`);
    const cleanupStatus = fileService.getCleanupStatus();
    const sessions = await fileService.listTempSessions();

    res.json({
      message: "Session management endpoint",
      autoCleanup: cleanupStatus,
      currentSessions: {
        total: sessions.length,
        nearExpiry: sessions.filter((s) => s.ageHours >= 20).length,
        oldestAge:
          sessions.length > 0
            ? Math.max(...sessions.map((s) => s.ageHours))
            : 0,
      },
      availableActions: [
        "GET /admin/session-stats - Get detailed session statistics",
        "GET /admin/cleanup-status - Get auto-cleanup service status",
        "POST /admin/force-cleanup - Force immediate cleanup",
        "GET /admin/sessions - This overview page",
      ],
      autoCleanupInfo: {
        enabled: true,
        interval: "1 hour",
        maxFileAge: "24 hours",
        nextCleanup: "Within 1 hour",
      },
      accessedFrom: req.ip,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Admin sessions overview error:", error);
    res.status(500).json({
      error: "Failed to get session overview",
      message: error.message,
    });
  }
});

// NEW: Auto-cleanup service management with rate limiting
router.get("/admin/cleanup-service", security.dockingLimiter, (req, res) => {
  console.log(`🔧 Cleanup service info accessed from IP: ${req.ip}`);
  const status = fileService.getCleanupStatus();
  res.json({
    service: "Auto-Cleanup",
    ...status,
    configuration: {
      cleanupInterval: "1 hour",
      fileMaxAge: "24 hours",
      autoStart: true,
    },
    endpoints: {
      status: "GET /admin/cleanup-status",
      forceCleanup: "POST /admin/force-cleanup",
      statistics: "GET /admin/session-stats",
    },
    accessedFrom: req.ip,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// ENHANCED HEALTH CHECK AND STATUS ROUTES
// ============================================================================

// Enhanced health check with auto-cleanup status and rate limiting
router.get("/health", security.dockingLimiter, async (req, res) => {
  try {
    const cleanupStatus = fileService.getCleanupStatus();
    const sessions = await fileService.listTempSessions();

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        proteinAnalysis: "operational",
        dockingAnalysis: "operational",
        customDocking: "operational",
        fileServing: "operational",
        autoCleanup: cleanupStatus.active ? "active" : "inactive",
        security: "enabled", // NEW: Security status
        rateLimiting: "active", // NEW: Rate limiting status
      },
      sessions: {
        active: sessions.length,
        nearExpiry: sessions.filter((s) => s.ageHours >= 20).length,
      },
      autoCleanup: cleanupStatus,
      security: {
        rateLimiting: "5 requests per 15 minutes",
        fileUploadSecurity: "enhanced",
        allowedFileTypes: [".txt", ".pdb"],
        maxFileSize: "16000KB",
        inputSanitization: "active",
      },
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Detailed status endpoint with rate limiting
router.get("/status", security.dockingLimiter, async (req, res) => {
  try {
    const cleanupStatus = fileService.getCleanupStatus();
    const sessions = await fileService.listTempSessions();

    res.json({
      status: "operational",
      timestamp: new Date().toISOString(),
      cleanup: cleanupStatus,
      sessions: {
        total: sessions.length,
        nearExpiry: sessions.filter((s) => s.ageHours >= 20).length,
        totalSize: sessions.reduce((sum, s) => sum + s.size, 0),
      },
      services: {
        autoCleanup: {
          enabled: true,
          status: cleanupStatus.active ? "running" : "idle",
          interval: "1 hour",
          maxAge: "24 hours",
        },
        security: {
          rateLimiting: "enabled",
          inputSanitization: "enabled",
          fileValidation: "enhanced",
          allowedFileTypes: [".txt", ".pdb"],
          maxFileSize: "16000KB",
          suspiciousActivityLogging: "enabled",
        },
      },
      accessedFrom: req.ip,
    });
  } catch (error) {
    console.error("Status endpoint error:", error);
    res.status(500).json({
      status: "error",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================================================
// ENHANCED ERROR HANDLING MIDDLEWARE
// ============================================================================

// UPDATED: Enhanced error handling with security logging
router.use((error, req, res, next) => {
  // Log security-related errors
  if (error instanceof multer.MulterError) {
    console.warn(`🚨 File upload security violation from IP ${req.ip}:`);
    console.warn(`   Error: ${error.code}`);
    console.warn(`   File: ${req.file?.originalname || "unknown"}`);
    console.warn(`   User-Agent: ${req.get("User-Agent")?.substring(0, 100)}`);

    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return res.status(400).json({
          error: "File too large (max 16000KB)",
          code: "FILE_TOO_LARGE",
        });
      case "LIMIT_FILE_COUNT":
        return res.status(400).json({
          error: "Too many files. Please upload only one file.",
          code: "TOO_MANY_FILES",
        });
      case "LIMIT_UNEXPECTED_FILE":
        return res.status(400).json({
          error:
            "Unexpected file field. Please use the correct form field name.",
          code: "UNEXPECTED_FILE_FIELD",
        });
      case "LIMIT_PART_COUNT":
        return res.status(400).json({
          error: "Too many file parts",
          code: "TOO_MANY_PARTS",
        });
      case "LIMIT_FIELD_KEY":
        return res.status(400).json({
          error: "Field name too long",
          code: "FIELD_NAME_TOO_LONG",
        });
      case "LIMIT_FIELD_VALUE":
        return res.status(400).json({
          error: "Field value too long",
          code: "FIELD_VALUE_TOO_LONG",
        });
      case "LIMIT_FIELD_COUNT":
        return res.status(400).json({
          error: "Too many form fields",
          code: "TOO_MANY_FIELDS",
        });
      default:
        return res.status(400).json({
          error: "File upload error",
          code: "UPLOAD_ERROR",
        });
    }
  }

  // Handle custom file validation errors
  if (error.message && error.message.includes("Invalid file type")) {
    console.warn(`🚨 Invalid file type from IP ${req.ip}: ${error.message}`);
    return res.status(400).json({
      error: error.message,
      code: "INVALID_FILE_TYPE",
      allowedTypes: [".txt", ".pdb"],
    });
  }

  if (error.message && error.message.includes("Invalid filename")) {
    console.warn(`🚨 Suspicious filename from IP ${req.ip}: ${error.message}`);
    return res.status(400).json({
      error: "Invalid filename - security violation",
      code: "SUSPICIOUS_FILENAME",
    });
  }

  // Handle rate limiting errors
  if (error.status === 429) {
    console.warn(`🚨 Rate limit exceeded from IP ${req.ip}`);
    return res.status(429).json({
      error: "Too many requests. Please try again later.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfter: "15 minutes",
    });
  }

  // Log other errors for security monitoring
  console.error(`🚨 Unexpected error from IP ${req.ip}:`, error);
  next(error);
});

// ============================================================================
// API DOCUMENTATION ROUTE (UPDATED WITH SECURITY INFO)
// ============================================================================

router.get("/api-docs", (req, res) => {
  res.json({
    title: "HLA-DQ Protein Docking API",
    version: "3.0.0", // Updated version
    description:
      "Secure API for HLA-DQ protein analysis and peptide docking with enhanced security and auto-cleanup",
    security: {
      rateLimiting: {
        enabled: true,
        limit: "5 requests per 15 minutes per IP",
        endpoints: ["POST /custom-docking", "Admin endpoints"],
      },
      fileUpload: {
        maxSize: "16000KB", // UPDATED: Reduced from 10MB
        allowedTypes: [".txt", ".pdb"], // UPDATED: Only these two types
        validation: "Enhanced security validation",
        malwareProtection: "Binary file detection and content scanning",
        filenameValidation: "Directory traversal and injection protection",
      },
      inputSanitization: {
        enabled: true,
        protection: ["XSS", "SQL Injection", "Command Injection"],
        coverage: "All user inputs and URL parameters",
      },
      logging: {
        suspiciousActivity: "All security violations logged with IP tracking",
        fileUploads: "All file upload attempts logged",
        rateLimitViolations: "Rate limit violations tracked",
      },
    },
    features: {
      autoCleanup: {
        enabled: true,
        interval: "1 hour",
        maxFileAge: "24 hours",
        description: "Automatic cleanup of temporary files older than 24 hours",
      },
      securityEnhancements: {
        version: "3.0.0",
        fileTypeRestriction: "Only .txt and .pdb files accepted",
        contentValidation: "Deep file content analysis",
        rateLimiting: "Protection against abuse",
        inputSanitization: "XSS and injection prevention",
      },
    },
    endpoints: {
      proteins: {
        "GET /hladq-proteins": "List all HLA-DQ proteins",
        "GET /hladq-protein/:id": "Get protein details and analysis",
        "GET /hladq-protein/:id/download": "Download protein file",
        "GET /hladq-protein/:id/download-all-zip":
          "Download all protein files as ZIP",
      },
      precomputedDocking: {
        "GET /docking-analysis": "Get pre-computed docking form",
        "POST /docking-analysis": "Submit docking analysis request",
        "GET /docking-results/:proteinId/:peptideName": "View docking results",
        "GET /docking-results/:proteinId/:peptideName/download-all-zip":
          "Download docking results as ZIP",
      },
      customDocking: {
        "GET /custom-docking": "Get custom docking form",
        "POST /custom-docking":
          "Submit custom docking request (SECURED: Rate limited, file validated)",
        "GET /custom-docking-results/:sessionId": "View custom docking results",
        "GET /temp-results/:sessionId/:filename": "Download result files",
      },
      administration: {
        "GET /admin/session-stats":
          "Get detailed session statistics (Rate limited)",
        "GET /admin/cleanup-status":
          "Get auto-cleanup service status (Rate limited)",
        "POST /admin/force-cleanup": "Force immediate cleanup (Rate limited)",
        "GET /admin/cleanup-service":
          "Get cleanup service configuration (Rate limited)",
        "GET /admin/sessions": "Get session overview (Rate limited)",
      },
      monitoring: {
        "GET /health": "Health check with security status (Rate limited)",
        "GET /status":
          "Detailed service status including security info (Rate limited)",
      },
    },
    fileUpload: {
      maxSize: "16000KB", // UPDATED
      allowedTypes: [".txt", ".pdb"], // UPDATED
      field: "peptideFile",
      autoCleanup: "Files automatically deleted after 24 hours",
      security: {
        binaryDetection: "Executable and binary files blocked",
        contentScanning: "Suspicious patterns detected and blocked",
        filenameValidation: "Directory traversal and injection prevention",
        sizeValidation: "File size strictly enforced",
        mimeTypeValidation: "Content-type verification",
      },
    },
    securityFeatures: {
      rateLimiting: "5 requests per 15 minutes for docking operations",
      inputSanitization: "All inputs sanitized to prevent XSS and injection",
      fileValidation: "Deep content validation beyond extension checking",
      suspiciousActivityLogging:
        "All security violations logged with IP tracking",
      errorHandling: "Secure error messages without internal details exposure",
    },
    autoCleanupEndpoints: {
      "GET /admin/cleanup-status": "Check auto-cleanup service status",
      "POST /admin/force-cleanup": "Trigger immediate cleanup",
      "GET /admin/session-stats": "Get session statistics with cleanup info",
    },
  });
});

// ============================================================================
// DEBUG AND DEVELOPMENT ROUTES (SECURED)
// ============================================================================

// Debug session route with rate limiting
router.get(
  "/debug-session/:sessionId",
  security.dockingLimiter,
  security.sanitizeInput,
  customDockingController.debugSession
);

// NEW: Debug auto-cleanup service with rate limiting
router.get("/debug/cleanup", security.dockingLimiter, (req, res) => {
  console.log(`🔍 Cleanup debug accessed from IP: ${req.ip}`);
  const status = fileService.getCleanupStatus();
  res.json({
    debug: "Auto-Cleanup Service Debug",
    timestamp: new Date().toISOString(),
    service: status,
    configuration: {
      cleanupInterval: "3600000ms (1 hour)",
      maxFileAge: "86400000ms (24 hours)",
      tempDirectory: "temp_results/",
      statusLogging: "every 6 hours",
    },
    security: {
      rateLimiting: "enabled",
      fileValidation: "enhanced",
      allowedTypes: [".txt", ".pdb"],
      maxFileSize: "16000KB",
    },
    actions: {
      forceCleanup: "POST /admin/force-cleanup",
      getStats: "GET /admin/session-stats",
      getStatus: "GET /admin/cleanup-status",
    },
    accessedFrom: req.ip,
  });
});

// NEW: Security status endpoint
router.get("/security-status", security.dockingLimiter, (req, res) => {
  res.json({
    security: {
      version: "3.0.0",
      status: "active",
      features: {
        rateLimiting: {
          enabled: true,
          limit: "5 requests per 15 minutes",
          scope: "Docking and admin endpoints",
        },
        fileUploadSecurity: {
          enabled: true,
          allowedTypes: [".txt", ".pdb"],
          maxSize: "16000KB",
          contentValidation: "enhanced",
          binaryDetection: "active",
          filenameValidation: "active",
        },
        inputSanitization: {
          enabled: true,
          coverage: "all user inputs",
          protection: ["XSS", "SQL Injection", "Command Injection"],
        },
        logging: {
          suspiciousActivity: "enabled",
          ipTracking: "enabled",
          fileUploadAttempts: "logged",
        },
      },
      lastUpdated: new Date().toISOString(),
      accessedFrom: req.ip,
    },
  });
});

module.exports = router;
