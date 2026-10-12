// scripts/cleanupUploads.js
const mongoose = require("mongoose");
const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

const Protein = require("../models/Protein");
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");

async function cleanupUploadsFolder() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // 1. Fetch all stored filenames from the DB
    const allProteins = await Protein.find({}, "files.storedName");
    const dbFileNames = new Set();

    allProteins.forEach((protein) => {
      protein.files.forEach((file) => dbFileNames.add(file.storedName));
    });

    // 2. List files in the uploads folder
    const uploadFiles = await fs.readdir(UPLOADS_DIR);
    let deletedCount = 0;

    for (const file of uploadFiles) {
      if (!dbFileNames.has(file)) {
        const filePath = path.join(UPLOADS_DIR, file);
        await fs.unlink(filePath);
        deletedCount++;
        console.log(`🗑️ Deleted orphan file: ${file}`);
      }
    }

    console.log(`✅ Cleanup complete. ${deletedCount} files removed.`);
    await mongoose.disconnect();
  } catch (err) {
    console.error("❌ Error during cleanup:", err.message);
    process.exit(1);
  }
}

cleanupUploadsFolder();
