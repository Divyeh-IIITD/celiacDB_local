const mongoose = require("mongoose");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const zlib = require("zlib");
require("dotenv").config();

const Protein = require("../models/Protein");

async function updateCeliacdbData() {
  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/pdb_database";
  console.log(`Connecting to MongoDB at: ${mongoUri}`);
  await mongoose.connect(mongoUri);

  try {
    // Find HLA DQ2.2
    let protein = await Protein.findOne({ name: /HLA[-\s]?DQ2\.2/i });
    if (!protein) {
      console.log("HLA-DQ2.2 not found, searching for any HLADQ protein...");
      protein = await Protein.findOne({ proteinType: "HLADQ" });
    }

    if (!protein) {
      console.error("❌ No HLA-DQ protein record found in database.");
      process.exit(1);
    }

    console.log(`Found protein record: ${protein.name} (_id: ${protein._id})`);

    const uploadsDir = path.join(__dirname, "../public/uploads");
    await fs.mkdir(uploadsDir, { recursive: true });

    // 1. Prepare complex PDB from HADDOCK run_dq2_peptide_ens
    const gzippedClusterPath = path.join(__dirname, "../run_dq2_peptide_ens/5_seletopclusts/cluster_1_model_1.pdb.gz");
    const storedComplexName = `dq2_2_peptide_ens_complex_${Date.now()}.pdb`;
    const complexDestPath = path.join(uploadsDir, storedComplexName);

    if (fsSync.existsSync(gzippedClusterPath)) {
      console.log(`Decompressing ${gzippedClusterPath} -> ${complexDestPath}...`);
      const gzBuffer = fsSync.readFileSync(gzippedClusterPath);
      const decompressed = zlib.gunzipSync(gzBuffer);
      await fs.writeFile(complexDestPath, decompressed);
    } else {
      console.warn("Reference cluster model not found at", gzippedClusterPath);
    }

    // 2. Prepare peptide ensemble PDB
    const peptideEnsSource = path.join(__dirname, "../peptide_ens.pdb");
    const storedPeptideName = `dq2_2_peptide_ens_${Date.now()}.pdb`;
    const peptideDestPath = path.join(uploadsDir, storedPeptideName);

    if (fsSync.existsSync(peptideEnsSource)) {
      console.log(`Copying peptide ensemble ${peptideEnsSource} -> ${peptideDestPath}...`);
      await fs.copyFile(peptideEnsSource, peptideDestPath);
    }

    // 3. Prepare docking log
    const logSource = path.join(__dirname, "../run_dq2_peptide_ens/log");
    const storedLogName = `dq2_2_peptide_ens_log_${Date.now()}.log`;
    const logDestPath = path.join(uploadsDir, storedLogName);
    let logContent = "";

    if (fsSync.existsSync(logSource)) {
      await fs.copyFile(logSource, logDestPath);
      logContent = await fs.readFile(logSource, "utf-8");
    }

    // 4. Update protein files list
    const statComplex = fsSync.existsSync(complexDestPath) ? await fs.stat(complexDestPath) : { size: 0 };
    const statPeptide = fsSync.existsSync(peptideDestPath) ? await fs.stat(peptideDestPath) : { size: 0 };
    const statLog = fsSync.existsSync(logDestPath) ? await fs.stat(logDestPath) : { size: 0 };

    protein.files.push(
      {
        originalName: "HLA-DQ2.2_peptide_ens_complex.pdb",
        storedName: storedComplexName,
        type: "pdb",
        size: statComplex.size,
        category: "complex_structure",
      },
      {
        originalName: "peptide_ens.pdb",
        storedName: storedPeptideName,
        type: "pdb",
        size: statPeptide.size,
        category: "structure",
      },
      {
        originalName: "haddock3_docking.log",
        storedName: storedLogName,
        type: "log",
        size: statLog.size,
        category: "docking_log",
        content: logContent.substring(0, 5000),
      }
    );

    // 5. Update or add dockingResult for peptide_ens
    const existingIndex = protein.dockingResults.findIndex((r) => r.peptideName === "peptide_ens");
    const dockingResultEntry = {
      peptideName: "peptide_ens",
      dockedStructureFile: storedPeptideName,
      complexStructureFile: storedComplexName,
      logFile: storedLogName,
      logContent: logContent.substring(0, 10000),
      topResults: [
        {
          mode: 1,
          affinity: -109.63, // HADDOCK Score
          rmsdLb: 0.0,
          rmsdUb: 0.0,
        },
      ],
      createdAt: new Date(),
    };

    if (existingIndex >= 0) {
      protein.dockingResults[existingIndex] = dockingResultEntry;
    } else {
      protein.dockingResults.push(dockingResultEntry);
    }

    protein.totalPeptides = protein.dockingResults.length;
    await protein.save();

    console.log(`✅ Successfully updated CeliacDB data for ${protein.name}!`);
    console.log(`   Total peptides: ${protein.totalPeptides}`);
    console.log(`   Added docking result for: peptide_ens (HADDOCK score: -109.63)`);

  } catch (error) {
    console.error("❌ Error updating CeliacDB data:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

if (require.main === module) {
  updateCeliacdbData();
}

module.exports = updateCeliacdbData;
