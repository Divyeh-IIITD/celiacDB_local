const fs = require("fs").promises;
const path = require("path");

class FileService {
  constructor() {
    this.cleanupInterval = null;
    this.isCleanupActive = false;
    this.maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    this.cleanupIntervalTime = 60 * 60 * 1000; // Check every hour

    // Start auto-cleanup when service is initialized
    this.startAutoCleanup();

    console.log("🗑️ FileService initialized with auto-cleanup");
    console.log(
      `⏰ Cleanup runs every ${this.cleanupIntervalTime / (60 * 1000)} minutes`
    );
    console.log(
      `🕒 Files expire after ${this.maxAge / (60 * 60 * 1000)} hours`
    );
  }

  // Start automatic cleanup scheduler
  startAutoCleanup() {
    if (this.cleanupInterval) {
      console.log("⚠️ Auto-cleanup already running");
      return;
    }

    console.log("🚀 Starting auto-cleanup scheduler...");
    this.isCleanupActive = true;

    // Run cleanup immediately on start
    this.performScheduledCleanup();

    // Schedule periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.performScheduledCleanup();
    }, this.cleanupIntervalTime);

    console.log("✅ Auto-cleanup scheduler started successfully");
  }

  // Stop automatic cleanup
  stopAutoCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.isCleanupActive = false;
      console.log("🛑 Auto-cleanup scheduler stopped");
    }
  }

  // Perform scheduled cleanup of expired sessions
  async performScheduledCleanup() {
    try {
      console.log("🔍 Running scheduled cleanup check...");
      const startTime = Date.now();

      const tempDir = path.join(__dirname, "../temp_results");

      if (!(await this.fileExists(tempDir))) {
        console.log("📁 No temp directory found - nothing to clean");
        return { cleanedSessions: 0, errors: 0 };
      }

      const files = await fs.readdir(tempDir);
      const sessionFiles = files.filter(
        (file) => file.endsWith(".json") && file.startsWith("session_")
      );

      let cleanedSessions = 0;
      let errors = 0;
      const expiredSessions = [];

      console.log(`📊 Found ${sessionFiles.length} session files to check`);

      for (const file of sessionFiles) {
        const sessionId = file.replace(".json", "");
        const resultFilePath = path.join(tempDir, file);
        const sessionDirPath = path.join(tempDir, sessionId);

        try {
          // Check if session has expired
          const stats = await this.getFileStats(resultFilePath);
          if (!stats) continue;

          const age = Date.now() - stats.mtime.getTime();
          const isExpired = age > this.maxAge;

          if (isExpired) {
            expiredSessions.push({
              sessionId,
              ageHours: Math.round(age / (60 * 60 * 1000)),
              size: stats.size,
            });

            // Clean up session directory if it exists
            if (await this.fileExists(sessionDirPath)) {
              await fs.rmdir(sessionDirPath, { recursive: true });
              console.log(`🗑️ Removed session directory: ${sessionId}`);
            }

            // Clean up result file
            await fs.unlink(resultFilePath);
            console.log(`🗑️ Removed session file: ${file}`);

            cleanedSessions++;
          }
        } catch (error) {
          console.error(
            `❌ Error cleaning session ${sessionId}:`,
            error.message
          );
          errors++;
        }
      }

      const duration = Date.now() - startTime;

      if (cleanedSessions > 0) {
        console.log(`✅ Cleanup completed in ${duration}ms:`);
        console.log(`   🗑️ Cleaned ${cleanedSessions} expired sessions`);
        console.log(`   ❌ ${errors} errors encountered`);

        expiredSessions.forEach((session) => {
          console.log(
            `   - ${session.sessionId} (${session.ageHours}h old, ${session.size} bytes)`
          );
        });
      } else {
        console.log(
          `✅ Cleanup check completed - no expired sessions found (${duration}ms)`
        );
      }

      return {
        cleanedSessions,
        errors,
        expiredSessions,
        duration,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ Scheduled cleanup failed:", error);
      return { cleanedSessions: 0, errors: 1, error: error.message };
    }
  }

  // Force cleanup now (manual trigger)
  async forceCleanupNow() {
    console.log("🚀 Manual cleanup triggered...");
    return await this.performScheduledCleanup();
  }

  // Get cleanup status
  getCleanupStatus() {
    return {
      active: this.isCleanupActive,
      intervalMinutes: this.cleanupIntervalTime / (60 * 1000),
      maxAgeHours: this.maxAge / (60 * 60 * 1000),
      nextCleanupIn: this.cleanupInterval
        ? `${Math.round(this.cleanupIntervalTime / (60 * 1000))} minutes`
        : "Not scheduled",
      lastCheck: new Date().toISOString(),
    };
  }

  // Check if file exists
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Get file stats safely
  async getFileStats(filePath) {
    try {
      return await fs.stat(filePath);
    } catch (error) {
      return null;
    }
  }

  // Read file safely with error handling
  async readFileSafe(filePath, encoding = "utf-8") {
    try {
      return await fs.readFile(filePath, encoding);
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error.message);
      return null;
    }
  }

  // Write file safely with directory creation
  async writeFileSafe(filePath, content, encoding = "utf-8") {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(filePath, content, encoding);
      return true;
    } catch (error) {
      console.error(`Error writing file ${filePath}:`, error.message);
      return false;
    }
  }

  // Clean up specific session (legacy method - now just checks if expired)
  async cleanupTempFiles(sessionId, maxAge = this.maxAge) {
    try {
      const tempDir = path.join(__dirname, "../temp_results");
      const sessionDir = path.join(tempDir, sessionId);
      const resultFile = path.join(tempDir, `${sessionId}.json`);

      // Check if files are older than maxAge
      const stats = await this.getFileStats(resultFile);
      if (stats && Date.now() - stats.mtime.getTime() > maxAge) {
        // Remove session directory
        if (await this.fileExists(sessionDir)) {
          await fs.rmdir(sessionDir, { recursive: true });
        }

        // Remove result file
        if (await this.fileExists(resultFile)) {
          await fs.unlink(resultFile);
        }

        console.log(`🗑️ Manually cleaned up expired session: ${sessionId}`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`Error cleaning up session ${sessionId}:`, error.message);
      return false;
    }
  }

  // List all temporary sessions with enhanced info
  async listTempSessions() {
    try {
      const tempDir = path.join(__dirname, "../temp_results");

      if (!(await this.fileExists(tempDir))) {
        return [];
      }

      const files = await fs.readdir(tempDir);
      const sessions = [];

      for (const file of files) {
        if (file.endsWith(".json") && file.startsWith("session_")) {
          const sessionId = file.replace(".json", "");
          const filePath = path.join(tempDir, file);
          const stats = await this.getFileStats(filePath);

          if (stats) {
            const age = Date.now() - stats.mtime.getTime();
            const ageHours = age / (60 * 60 * 1000);
            const isExpired = age > this.maxAge;

            sessions.push({
              sessionId,
              created: stats.birthtime,
              modified: stats.mtime,
              size: stats.size,
              ageHours: Math.round(ageHours * 10) / 10, // Round to 1 decimal
              isExpired,
              expiresIn: isExpired
                ? 0
                : Math.round((this.maxAge - age) / (60 * 60 * 1000)),
            });
          }
        }
      }

      // Sort by modification time (newest first)
      sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());

      return sessions;
    } catch (error) {
      console.error("Error listing temp sessions:", error.message);
      return [];
    }
  }

  // Get storage statistics
  async getStorageStats() {
    try {
      const sessions = await this.listTempSessions();

      const stats = {
        totalSessions: sessions.length,
        expiredSessions: sessions.filter((s) => s.isExpired).length,
        totalSize: sessions.reduce((sum, s) => sum + s.size, 0),
        oldestSessionAge:
          sessions.length > 0
            ? Math.max(...sessions.map((s) => s.ageHours))
            : 0,
        avgSessionAge:
          sessions.length > 0
            ? sessions.reduce((sum, s) => sum + s.ageHours, 0) / sessions.length
            : 0,
      };

      return stats;
    } catch (error) {
      console.error("Error getting storage stats:", error.message);
      return null;
    }
  }

  // Graceful shutdown
  shutdown() {
    console.log("🛑 FileService shutting down...");
    this.stopAutoCleanup();
    console.log("✅ FileService shutdown complete");
  }
}

// Create singleton instance
const fileServiceInstance = new FileService();

// Handle process termination
process.on("SIGINT", () => {
  fileServiceInstance.shutdown();
});

process.on("SIGTERM", () => {
  fileServiceInstance.shutdown();
});

module.exports = fileServiceInstance;
