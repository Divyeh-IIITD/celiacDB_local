const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");
const expressLayouts = require("express-ejs-layouts");

// Import security middleware
const security = require("./middleware/security");

dotenv.config();

const app = express();

// Import the fileService to initialize auto-cleanup
const fileService = require("./services/fileService");

// Auto-cleanup status logging on startup
console.log("🚀 Application starting...");
console.log("✅ Auto-cleanup service initialized and running");
console.log("🕒 Temporary files are automatically cleaned every hour");
console.log("📁 Files older than 24 hours are automatically deleted");
console.log("🔄 Auto-cleanup started immediately on service initialization");

const indexRoutes = require("./routes/index");

// Import controller for admin routes
const customDockingController = require("./controllers/customDockingController");

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error(err));

// SECURITY: Trust proxy for accurate IP addresses (important for rate limiting)
app.set("trust proxy", 1);

// SECURITY: Apply security headers first
app.use(security.securityHeaders);

// SECURITY: Request logging for monitoring
app.use(security.requestLogger);

// Basic middleware
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders: (res, path) => {
      if (path.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  })
);


// Serve temp results files for custom docking - FIXED PATH
app.use("/temp-results", express.static(path.join(__dirname, "temp_results")));

// EJS setup with layouts
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// SECURITY: Admin routes with rate limiting (before main routes)
app.get(
  "/admin/cleanup-status",
  security.dockingLimiter,
  customDockingController.getAutoCleanupStatus
);
app.post(
  "/admin/force-cleanup",
  security.dockingLimiter,
  security.sanitizeInput,
  customDockingController.forceCleanupNow
);
app.get(
  "/admin/session-stats",
  security.dockingLimiter,
  customDockingController.getSessionStats
);

// Enhanced admin route for storage statistics with security
app.get("/admin/storage-stats", security.dockingLimiter, async (req, res) => {
  try {
    const stats = await fileService.getStorageStats();
    const sessions = await fileService.listTempSessions();
    const cleanupStatus = fileService.getCleanupStatus();

    res.json({
      storage: stats,
      sessions: sessions.slice(0, 10), // Show only first 10 sessions
      cleanup: cleanupStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Storage stats error:", error);
    res.status(500).json({ error: "Failed to get storage stats" });
  }
});

// SECURITY: Manual cleanup trigger routes with enhanced security
app.get("/admin/cleanup-now", security.dockingLimiter, async (req, res) => {
  try {
    console.log(`🚀 Manual cleanup triggered via GET from IP: ${req.ip}`);
    const result = await fileService.forceCleanupNow();

    res.json({
      message: "Manual cleanup completed successfully",
      method: "GET",
      ...result,
    });
  } catch (error) {
    console.error("❌ Manual cleanup failed:", error);
    res.status(500).json({
      error: "Manual cleanup failed",
      message: error.message,
    });
  }
});

app.post(
  "/admin/cleanup-now",
  security.dockingLimiter,
  security.sanitizeInput,
  async (req, res) => {
    try {
      console.log(`🚀 Manual cleanup triggered via POST from IP: ${req.ip}`);
      const result = await fileService.forceCleanupNow();

      res.json({
        message: "Manual cleanup completed successfully",
        method: "POST",
        ...result,
      });
    } catch (error) {
      console.error("❌ Manual cleanup failed:", error);
      res.status(500).json({
        error: "Manual cleanup failed",
        message: error.message,
      });
    }
  }
);

// Health check endpoints with basic rate limiting
app.get("/health", security.dockingLimiter, async (req, res) => {
  try {
    const cleanupStatus = fileService.getCleanupStatus();
    const storageStats = await fileService.getStorageStats();

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        autoCleanup: cleanupStatus.active ? "active" : "inactive",
        tempStorage: "available",
        mongodb:
          mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      },
      cleanup: cleanupStatus,
      storage: storageStats,
    });
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Enhanced service status endpoint with rate limiting
app.get("/status", security.dockingLimiter, async (req, res) => {
  try {
    const cleanupStatus = fileService.getCleanupStatus();
    const sessions = await fileService.listTempSessions();
    const storageStats = await fileService.getStorageStats();

    res.json({
      status: "operational",
      timestamp: new Date().toISOString(),
      cleanup: {
        ...cleanupStatus,
        sessionsTotal: sessions.length,
        sessionsExpired: sessions.filter((s) => s.isExpired).length,
        sessionsNearExpiry: sessions.filter((s) => s.ageHours >= 20).length,
      },
      storage: storageStats,
      database: {
        status:
          mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        host: process.env.MONGO_URI ? "configured" : "not configured",
      },
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// SECURITY: Main routes with custom docking endpoints secured
app.use("/", indexRoutes);

// SECURITY: Custom docking routes with full security stack
app.get("/custom-docking", customDockingController.getCustomDockingForm);

app.post(
  "/custom-docking",
  security.dockingLimiter, // Rate limiting: 5 requests per 15 minutes
  security.sanitizeInput, // Input sanitization for XSS prevention
  security.dockingUpload, // Secure multi-part upload (peptideFile + optional configFile)
  customDockingController.submitCustomDocking
);

app.get(
  "/custom-docking-results/:sessionId",
  security.sanitizeInput, // Sanitize URL parameters
  customDockingController.getCustomDockingResults
);

app.get(
  "/temp-results/:sessionId/:filename",
  security.sanitizeInput, // Sanitize URL parameters
  customDockingController.serveTempFile
);

// SECURITY: Debug routes with enhanced security (PRODUCTION: Consider removing these)
app.get("/admin/list-sessions", security.dockingLimiter, async (req, res) => {
  try {
    // SECURITY: Add IP logging for admin access
    console.log(`📊 Admin session list accessed from IP: ${req.ip}`);

    const sessions = await fileService.listTempSessions();
    const now = new Date();

    const sessionDetails = sessions.map((session) => {
      const ageMs = now.getTime() - session.modified.getTime();
      const ageHours = ageMs / (60 * 60 * 1000);
      const ageMinutes = ageMs / (60 * 1000);
      const isExpired = ageMs > 24 * 60 * 60 * 1000; // 24 hours

      return {
        sessionId: session.sessionId,
        created: session.created,
        modified: session.modified,
        ageMinutes: Math.round(ageMinutes * 10) / 10,
        ageHours: Math.round(ageHours * 10) / 10,
        isExpired,
        timeUntilExpiry: isExpired ? 0 : Math.round((24 - ageHours) * 10) / 10,
        size: session.size,
      };
    });

    // Sort by age (oldest first)
    sessionDetails.sort((a, b) => b.ageHours - a.ageHours);

    res.json({
      totalSessions: sessions.length,
      expiredSessions: sessionDetails.filter((s) => s.isExpired).length,
      maxAgeHours: 24,
      currentTime: now.toISOString(),
      accessedFrom: req.ip,
      sessions: sessionDetails,
    });
  } catch (error) {
    console.error("List sessions error:", error);
    res.status(500).json({ error: error.message });
  }
});

// SECURITY: Force cleanup with enhanced logging and validation
app.get(
  "/admin/force-cleanup-all",
  security.dockingLimiter,
  async (req, res) => {
    try {
      // SECURITY: Log this potentially dangerous operation
      console.warn(`⚠️ FORCE CLEANUP ALL requested from IP: ${req.ip}`);
      console.warn(`⚠️ User-Agent: ${req.get("User-Agent")}`);

      const { maxAgeMinutes } = req.query;

      // SECURITY: Validate and sanitize maxAgeMinutes parameter
      let customMaxAge;
      if (maxAgeMinutes) {
        const parsedMinutes = parseInt(maxAgeMinutes);
        if (
          isNaN(parsedMinutes) ||
          parsedMinutes < 0 ||
          parsedMinutes > 10080
        ) {
          // Max 1 week
          return res.status(400).json({
            error: "Invalid maxAgeMinutes parameter (must be 0-10080)",
          });
        }
        customMaxAge = parsedMinutes * 60 * 1000;
      } else {
        customMaxAge = 1 * 60 * 1000; // Default: 1 minute for testing
      }

      console.log(
        `🚀 FORCE CLEANUP with custom age: ${
          customMaxAge / (60 * 1000)
        } minutes`
      );

      const tempDir = path.join(__dirname, "temp_results");
      const files = await require("fs").promises.readdir(tempDir);
      const sessionFiles = files.filter(
        (file) => file.endsWith(".json") && file.startsWith("session_")
      );

      let cleanedSessions = 0;
      let errors = 0;
      const cleanedList = [];

      for (const file of sessionFiles) {
        const sessionId = file.replace(".json", "");
        const resultFilePath = path.join(tempDir, file);
        const sessionDirPath = path.join(tempDir, sessionId);

        try {
          const stats = await require("fs").promises.stat(resultFilePath);
          const age = Date.now() - stats.mtime.getTime();

          if (age > customMaxAge) {
            // Clean up session directory
            if (await fileService.fileExists(sessionDirPath)) {
              await require("fs").promises.rmdir(sessionDirPath, {
                recursive: true,
              });
            }

            // Clean up result file
            await require("fs").promises.unlink(resultFilePath);

            cleanedList.push({
              sessionId,
              ageMinutes: Math.round((age / (60 * 1000)) * 10) / 10,
              size: stats.size,
            });

            cleanedSessions++;
            console.log(
              `🗑️ Force cleaned: ${sessionId} (${Math.round(
                age / (60 * 1000)
              )} min old)`
            );
          }
        } catch (error) {
          console.error(`❌ Error force cleaning ${sessionId}:`, error.message);
          errors++;
        }
      }

      // SECURITY: Log the results of this operation
      console.warn(
        `⚠️ FORCE CLEANUP completed: ${cleanedSessions} sessions cleaned by IP ${req.ip}`
      );

      res.json({
        message: `Force cleanup completed with custom age: ${
          customMaxAge / (60 * 1000)
        } minutes`,
        cleanedSessions,
        errors,
        cleanedList,
        requestedBy: req.ip,
        warning: "This was a FORCE cleanup - use with caution!",
      });
    } catch (error) {
      console.error("Force cleanup error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Route to check cleanup configuration with rate limiting
app.get("/admin/cleanup-config", security.dockingLimiter, async (req, res) => {
  try {
    console.log(`🔧 Cleanup config accessed from IP: ${req.ip}`);
    const cleanupStatus = fileService.getCleanupStatus();

    res.json({
      configuration: {
        maxAgeHours: cleanupStatus.maxAgeHours,
        maxAgeMs: cleanupStatus.maxAgeHours * 60 * 60 * 1000,
        intervalMinutes: cleanupStatus.intervalMinutes,
        active: cleanupStatus.active,
      },
      currentTime: new Date().toISOString(),
      accessedFrom: req.ip,
      explanation: {
        "24hours": "Sessions are only deleted after 24 hours (1440 minutes)",
        automatic: "Cleanup runs every hour automatically",
        manual: "Manual cleanup also respects the 24-hour rule",
      },
    });
  } catch (error) {
    console.error("Cleanup config error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced periodic status logging every 2 hours
const statusLogInterval = setInterval(async () => {
  try {
    const sessions = await fileService.listTempSessions();
    const expired = sessions.filter((s) => s.isExpired).length;
    const nearExpiry = sessions.filter(
      (s) => s.ageHours >= 20 && !s.isExpired
    ).length;
    const storageStats = await fileService.getStorageStats();

    if (sessions.length > 0) {
      console.log("📊 === CLEANUP STATUS REPORT ===");
      console.log(`📁 Total sessions: ${sessions.length}`);
      console.log(`🗑️ Expired sessions: ${expired}`);
      console.log(`⚠️ Sessions near expiry: ${nearExpiry}`);
      console.log(
        `💾 Total storage: ${
          Math.round((storageStats.totalSize / 1024 / 1024) * 100) / 100
        } MB`
      );
      console.log(
        `⏰ Oldest session: ${
          Math.round(storageStats.oldestSessionAge * 10) / 10
        } hours`
      );
      console.log(
        `📊 Average session age: ${
          Math.round(storageStats.avgSessionAge * 10) / 10
        } hours`
      );
      console.log("================================");
    } else {
      console.log("📊 Session Status: No active sessions (all clean)");
    }
  } catch (error) {
    console.error("❌ Error logging session status:", error);
  }
}, 2 * 60 * 60 * 1000); // Every 2 hours

// Immediate status log on startup (after 10 seconds)
setTimeout(async () => {
  try {
    const sessions = await fileService.listTempSessions();
    const cleanupStatus = fileService.getCleanupStatus();

    console.log("🎯 === STARTUP STATUS ===");
    console.log("🔒 Security features: ENABLED");
    console.log("🛡️ Rate limiting: ACTIVE");
    console.log("🧹 Input sanitization: ACTIVE");
    console.log("📁 Secure file upload: ACTIVE");
    console.log(
      `🔄 Auto-cleanup: ${cleanupStatus.active ? "ACTIVE" : "INACTIVE"}`
    );
    console.log(`📁 Existing sessions: ${sessions.length}`);
    console.log(
      `⏰ Cleanup interval: ${cleanupStatus.intervalMinutes} minutes`
    );
    console.log(`🕒 File expiry: ${cleanupStatus.maxAgeHours} hours`);
    console.log("========================");
  } catch (error) {
    console.error("❌ Error in startup status log:", error);
  }
}, 10000);

// SECURITY: Apply security error handler AFTER all routes but BEFORE general error handler
app.use(security.securityErrorHandler);

// Enhanced graceful shutdown handling with safeguards
let isShuttingDown = false; // Prevent multiple shutdown attempts

const gracefulShutdown = (signal) => {
  if (isShuttingDown) {
    console.log(`⚠️ ${signal} received but shutdown already in progress...`);
    return;
  }
  
  isShuttingDown = true;
  console.log(`\n🛑 ${signal} received - initiating graceful shutdown...`);
  console.log("🗑️ Stopping auto-cleanup service...");

  // Set a timeout to force exit if graceful shutdown hangs
  const forceExitTimeout = setTimeout(() => {
    console.error("⚠️ Graceful shutdown timed out, forcing exit...");
    process.exit(1);
  }, 10000); // 10 seconds timeout

  try {
    // Stop the file service cleanup
    if (typeof fileService !== 'undefined' && fileService.shutdown) {
      fileService.shutdown();
    }

    // Clear the status logging interval
    if (statusLogInterval) {
      clearInterval(statusLogInterval);
      console.log("📊 Status logging stopped");
    }

    // Close MongoDB connection with Promise (no callback)
    if (mongoose.connection.readyState !== 0) {
      mongoose.connection.close()
        .then(() => {
          clearTimeout(forceExitTimeout);
          console.log("📝 MongoDB connection closed");
          console.log("✅ Graceful shutdown completed");
          process.exit(0);
        })
        .catch((err) => {
          clearTimeout(forceExitTimeout);
          console.error("❌ Error closing MongoDB connection:", err.message);
          console.log("✅ Graceful shutdown completed (with MongoDB error)");
          process.exit(0);
        });
    } else {
      clearTimeout(forceExitTimeout);
      console.log("📝 MongoDB connection already closed");
      console.log("✅ Graceful shutdown completed");
      process.exit(0);
    }
  } catch (error) {
    clearTimeout(forceExitTimeout);
    console.error("❌ Error during graceful shutdown:", error.message);
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Handle uncaught exceptions with safeguards - DO NOT call gracefulShutdown recursively
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error.message);
  console.error("🚨 This could be a security concern - investigate immediately");
  
  if (!isShuttingDown) {
    console.error("🛑 Exiting due to uncaught exception...");
    process.exit(1);
  }
});

// Handle unhandled rejections with safeguards - DO NOT call gracefulShutdown recursively
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise);
  console.error("❌ Reason:", reason);
  
  // During shutdown, unhandled rejections are expected, so don't exit
  if (isShuttingDown) {
    console.log("ℹ️ Unhandled rejection during shutdown - this is expected");
    return;
  }
  
  console.error("🚨 This could be a security concern - investigate immediately");
  console.error("🛑 Exiting due to unhandled rejection...");
  process.exit(1);
});

// SECURITY: Enhanced error handling middleware (MUST be last)
app.use((err, req, res, next) => {
  console.error("❌ Application error:", err);
  console.error(
    `🚨 Error from IP: ${req.ip}, Path: ${req.path}, Method: ${req.method}`
  );

  // Don't expose internal errors to clients
  if (process.env.NODE_ENV === "production") {
    res.status(500).json({ error: "Internal server error" });
  } else {
    res.status(500).json({
      error: "Internal server error",
      message: err.message,
      stack: err.stack,
    });
  }
});

// 404 handler with security logging
app.use((req, res) => {
  console.warn(
    `🚨 404 - Path not found: ${req.method} ${req.path} from IP: ${req.ip}`
  );
  res.status(404).json({ error: "Resource not found" });
});

// Start server with enhanced security logging
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🌐 Server running at http://localhost:${PORT}`);
  console.log(`🔒 Security features: ENABLED`);
  console.log(`🛡️ Rate limiting: 5 requests per 15 minutes`);
  console.log(`🧹 Input sanitization: ACTIVE`);
  console.log(`📁 Secure file upload: 16000KB max, restricted types`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 Status page: http://localhost:${PORT}/status`);
  console.log(
    `🔧 Admin cleanup: http://localhost:${PORT}/admin/cleanup-status`
  );
  console.log(`💾 Storage stats: http://localhost:${PORT}/admin/storage-stats`);
  console.log(`🚀 Manual cleanup: http://localhost:${PORT}/admin/cleanup-now`);
  console.log(
    `🗑️ Force cleanup: POST http://localhost:${PORT}/admin/cleanup-now`
  );
  console.log("🔒 All admin routes are rate-limited for security");
});

module.exports = app;