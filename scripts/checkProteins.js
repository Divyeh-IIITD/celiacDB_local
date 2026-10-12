const mongoose = require("mongoose");
const Protein = require("../models/Protein");
require("dotenv").config();

async function checkProteins() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    // Get all proteins
    const allProteins = await Protein.find();
    console.log(`\n📊 TOTAL PROTEINS IN DATABASE: ${allProteins.length}\n`);

    if (allProteins.length === 0) {
      console.log("❌ No proteins found in database!");
      return;
    }

    // Check each protein
    allProteins.forEach((protein, index) => {
      console.log(`${index + 1}. NAME: ${protein.name}`);
      console.log(`   TYPE: ${protein.proteinType || "NOT SET"}`);
      console.log(`   FILES: ${protein.files.length}`);
      console.log(`   DOCKING RESULTS: ${protein.dockingResults.length}`);
      console.log(
        `   MAIN PROTEIN FILE: ${protein.mainProteinFile || "NOT SET"}`
      );
      console.log("   ---");
    });

    // Check HLADQ specifically
    const hladqProteins = await Protein.find({ proteinType: "HLADQ" });
    console.log(`\n🧬 HLA-DQ PROTEINS: ${hladqProteins.length}`);

    // Fix missing proteinType
    const proteinsWithoutType = await Protein.find({
      $or: [
        { proteinType: { $exists: false } },
        { proteinType: null },
        { proteinType: "" },
      ],
    });

    if (proteinsWithoutType.length > 0) {
      console.log(
        `\n🔧 FIXING ${proteinsWithoutType.length} proteins without proteinType...`
      );

      for (const protein of proteinsWithoutType) {
        // Check if name contains HLA-DQ
        if (
          protein.name.toLowerCase().includes("hla-dq") ||
          protein.name.toLowerCase().includes("hladq")
        ) {
          protein.proteinType = "HLADQ";
          await protein.save();
          console.log(`✅ Fixed: ${protein.name} -> HLADQ`);
        } else {
          protein.proteinType = "OTHER";
          await protein.save();
          console.log(`✅ Fixed: ${protein.name} -> OTHER`);
        }
      }
    }

    // Check again after fix
    const finalHladqCount = await Protein.countDocuments({
      proteinType: "HLADQ",
    });
    console.log(`\n✅ FINAL HLA-DQ PROTEIN COUNT: ${finalHladqCount}`);

    await mongoose.disconnect();
  } catch (err) {
    console.error("❌ Error:", err);
  }
}

checkProteins();
