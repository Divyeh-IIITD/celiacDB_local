const mongoose = require("mongoose");
const Protein = require("../models/Protein");
// adjust path as needed
require("dotenv").config();

// 🗑️ Pass a filter object to control what to delete
async function deleteProteins(filter = {}) {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("📊 Connected to MongoDB");

    const result = await Protein.deleteMany(filter);

    console.log(
      `✅ Deleted ${result.deletedCount} proteins matching filter:`,
      filter
    );

    await mongoose.disconnect();
  } catch (err) {
    console.error("❌ Error:", err.message || err);
  }
}

// --------------------------
// 💡 Usage Examples:
// --------------------------

// 1. Delete ALL proteins (same as before):
// deleteProteins();

// 2. Delete by name:
deleteProteins({ name: "HLA DQ5" });

// 3. Delete by proteinType:
// deleteProteins({ proteinType: "HLADQ" });

// 4. Delete multiple by name (use $in):
// deleteProteins({ name: { $in: ["HLA DQ5", "HLA DQ2.5"] } });

// 5. Delete older than a certain date:
// deleteProteins({ uploadedAt: { $lt: new Date("2025-01-01") } });
