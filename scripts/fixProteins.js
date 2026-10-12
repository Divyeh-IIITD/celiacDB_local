const mongoose = require("mongoose");
const Protein = require("../models/Protein");
require("dotenv").config();

async function fixProteins() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Get all proteins
    const allProteins = await Protein.find();
    console.log(`\n📊 TOTAL PROTEINS IN DATABASE: ${allProteins.length}\n`);

    // Fix ALL proteins to be HLADQ type (since they're all HLA-DQ related)
    for (const protein of allProteins) {
      console.log(`🔧 Setting ${protein.name} -> HLADQ`);
      protein.proteinType = "HLADQ";
      await protein.save();
    }

    // Check final count
    const finalHladqCount = await Protein.countDocuments({
      proteinType: "HLADQ",
    });
    console.log(`\n✅ FINAL HLA-DQ PROTEIN COUNT: ${finalHladqCount}`);

    // Show all proteins with their details
    const updatedProteins = await Protein.find();
    console.log("\n📋 ALL PROTEINS:");
    updatedProteins.forEach((protein, index) => {
      console.log(
        `${index + 1}. ${protein.name} (Type: ${protein.proteinType})`
      );
      console.log(`   Docking Results: ${protein.dockingResults.length}`);
      console.log(`   Files: ${protein.files.length}`);
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

fixProteins();
