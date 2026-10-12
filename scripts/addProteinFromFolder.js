const mongoose = require("mongoose");
const fs = require("fs").promises;
const path = require("path");
const fse = require("fs-extra");
const Protein = require("../models/Protein");
require("dotenv").config();

const UPLOADS_DIR = path.join(__dirname, "../public/uploads");

const name = "HLA DQ2.2";
const folderPath = path.join(__dirname, "../data/HLA-DQ_Proteins/HLA-DQ2.2");
const analysis =
  "Comprehensive data for the HLA-DQ2.2 protein including structure, docking, and complex structures.";

const categorizeFile = (ext, filename, relativePath) => {
  const lower = filename.toLowerCase();
  if (relativePath.includes("images")) return "image";
  if (relativePath.includes("metrics")) return "metric";
  if (relativePath.includes("simulation")) return "simulation";

  // Handle outputs folder (individual peptide and log files)
  if (relativePath.includes("outputs") && ext === ".pdb")
    return "docked_structure";
  if (relativePath.includes("outputs") && (ext === ".log" || ext === ".txt"))
    return "docking_log";

  // Handle complexes folder (protein+peptide complex structures)
  if (relativePath.includes("complexes") && ext === ".pdb")
    return "complex_structure";

  // Main protein and config files
  if (lower.startsWith("hla-dq") && ext === ".pdb") return "main_protein";
  if (lower.includes("conf")) return "config";

  // General categorization
  if ([".png", ".jpg", ".jpeg"].includes(ext)) return "image";
  if ([".xtc", ".tpr", ".gro"].includes(ext)) return "simulation";
  if ([".txt", ".area", ".thickness"].includes(ext)) return "metric";

  return "other";
};

const shouldParseContent = (ext) =>
  [".txt", ".area", ".thickness", ".gro", ".log"].includes(ext.toLowerCase());

const parseTabularContent = (text) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => line.split(/\s+/).map((cell) => cell.trim()));
};

const parseDockingLog = (logContent) => {
  const lines = logContent.split("\n");
  const results = [];
  let inResultsSection = false;

  for (let line of lines) {
    line = line.trim();
    if (
      line.includes("mode") &&
      line.includes("affinity") &&
      (line.includes("rmsd") || line.includes("dist from best mode"))
    ) {
      inResultsSection = true;
      continue;
    }
    if (inResultsSection && /^\s*\d+/.test(line)) {
      const parts = line.split(/\s+/).filter((part) => part.trim().length > 0);
      if (parts.length >= 4) {
        results.push({
          mode: parseInt(parts[0]),
          affinity: parseFloat(parts[1]),
          rmsdLb: parseFloat(parts[2]),
          rmsdUb: parseFloat(parts[3]),
        });
      }
      if (results.length >= 20) break; // Get more results for better analysis
    }
    if (inResultsSection && line.includes("-----")) continue;
    if (inResultsSection && line.includes("Writing output")) break;
  }

  return results;
};

// Extract peptide name from different file naming patterns
const extractPeptideName = (filename, category) => {
  const baseName = path.basename(filename, path.extname(filename));

  if (category === "docking_log") {
    // Match patterns like: DQ25_log.txt, peptide1_log.txt, etc.
    const logMatch = baseName.match(/^(?:DQ)?(.+?)(?:_log)?$/i);
    return logMatch ? logMatch[1].replace(/^DQ/i, "") : baseName;
  }

  if (category === "docked_structure") {
    // Match patterns like: DQ25_out.pdb, peptide1_out.pdb, etc.
    const pdbMatch = baseName.match(/^(?:DQ)?(.+?)(?:_out)?$/i);
    return pdbMatch ? pdbMatch[1].replace(/^DQ/i, "") : baseName;
  }

  if (category === "complex_structure") {
    // Match patterns like: HLA-DQ2.5_peptide1_complex.pdb, DQ25_complex.pdb, etc.
    const complexMatch = baseName.match(
      /(?:HLA-DQ\d+\.?\d*_)?(?:DQ)?(.+?)(?:_complex)?$/i
    );
    return complexMatch ? complexMatch[1].replace(/^DQ/i, "") : baseName;
  }

  return baseName;
};

async function getAllFiles(dir, relPath = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const rel = path.join(relPath, entry.name);

    if (entry.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, rel);
      files = files.concat(subFiles);
    } else {
      files.push({ fullPath, relPath: rel, name: entry.name });
    }
  }

  return files;
}

async function addProteinFromFolder() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("📊 Connected to MongoDB");

    const allFiles = await getAllFiles(folderPath);
    if (allFiles.length === 0)
      throw new Error(`❌ No files found in ${folderPath}`);

    console.log(`📁 Found ${allFiles.length} files in ${folderPath}`);

    const fileMetaList = [];
    const dockingResults = [];
    let mainProteinFile = null;
    let configFile = null;

    const peptideMap = {}; // peptideName → { pdb, log, complex }

    for (const file of allFiles) {
      const ext = path.extname(file.name).toLowerCase();
      const baseName = path.basename(file.name);
      const category = categorizeFile(ext, baseName, file.relPath);

      console.log(`📄 Processing: ${file.relPath} (${category})`);

      const storedName =
        Date.now() +
        "-" +
        Math.random().toString(36).substr(2, 9) +
        "-" +
        baseName.replace(/\s+/g, "_");

      const destPath = path.join(UPLOADS_DIR, storedName);
      await fse.copy(file.fullPath, destPath);
      const stats = await fse.stat(file.fullPath);

      const fileMeta = {
        originalName: baseName,
        storedName,
        type: ext.slice(1),
        size: stats.size,
        category,
      };

      // Parse content for text files
      if (shouldParseContent(ext) && stats.size < 5 * 1024 * 1024) {
        const raw = await fs.readFile(file.fullPath, "utf-8");
        fileMeta.content = raw;

        if (category === "docking_log") {
          const topResults = parseDockingLog(raw);
          fileMeta.parsedTable = parseTabularContent(raw);

          const peptideName = extractPeptideName(baseName, category);
          console.log(`🧬 Found docking log for peptide: ${peptideName}`);

          if (!peptideMap[peptideName]) peptideMap[peptideName] = {};
          peptideMap[peptideName].log = {
            storedName,
            raw,
            topResults,
          };
        } else {
          fileMeta.parsedTable = parseTabularContent(raw);
        }
      }

      // Identify main protein and config files
      if (category === "main_protein") {
        mainProteinFile = storedName;
        console.log(`🧬 Main protein file: ${baseName}`);
      }
      if (category === "config") {
        configFile = storedName;
        console.log(`⚙️ Config file: ${baseName}`);
      }

      // Handle docked structure files (individual peptides)
      if (category === "docked_structure") {
        const peptideName = extractPeptideName(baseName, category);
        console.log(`🔬 Found docked structure for peptide: ${peptideName}`);

        if (!peptideMap[peptideName]) peptideMap[peptideName] = {};
        peptideMap[peptideName].pdb = storedName;
      }

      // Handle complex structure files (protein+peptide complexes)
      if (category === "complex_structure") {
        const peptideName = extractPeptideName(baseName, category);
        console.log(`🔗 Found complex structure for peptide: ${peptideName}`);

        if (!peptideMap[peptideName]) peptideMap[peptideName] = {};
        peptideMap[peptideName].complex = storedName;
      }

      fileMetaList.push(fileMeta);
    }

    // Construct docking results with complex structures
    console.log("\n📋 Building docking results...");
    for (const peptideName in peptideMap) {
      const entry = peptideMap[peptideName];

      // We need at least a log file to create a docking result
      if (entry.log) {
        const dockingResult = {
          peptideName,
          logFile: entry.log.storedName,
          logContent: entry.log.raw,
          topResults: entry.log.topResults,
        };

        // Add docked structure if available
        if (entry.pdb) {
          dockingResult.dockedStructureFile = entry.pdb;
        }

        // Add complex structure if available
        if (entry.complex) {
          dockingResult.complexStructureFile = entry.complex;
        }

        dockingResults.push(dockingResult);

        const structureInfo = [];
        if (entry.pdb) structureInfo.push("peptide PDB");
        if (entry.complex) structureInfo.push("complex PDB");

        console.log(`✅ ${peptideName}: log + ${structureInfo.join(" + ")}`);
      } else {
        console.log(`⚠️ ${peptideName}: missing log file, skipping`);
      }
    }

    const protein = new Protein({
      name,
      analysis,
      files: fileMetaList,
      uploadedAt: new Date(),
      mainProteinFile,
      configFile,
      dockingResults,
      totalPeptides: dockingResults.length,
      proteinType: "HLADQ",
    });

    await protein.save();

    console.log("\n🎉 SUCCESS!");
    console.log(`✅ Saved protein "${name}"`);
    console.log(`📁 Total files: ${fileMetaList.length}`);
    console.log(`🧬 Docking results: ${dockingResults.length}`);
    console.log(`🔬 Main protein: ${mainProteinFile ? "Found" : "Missing"}`);
    console.log(`⚙️ Config file: ${configFile ? "Found" : "Missing"}`);

    // Summary by category
    const categories = {};
    fileMetaList.forEach((file) => {
      categories[file.category] = (categories[file.category] || 0) + 1;
    });

    console.log("\n📊 File categories:");
    Object.entries(categories).forEach(([cat, count]) => {
      console.log(`   ${cat}: ${count} files`);
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error("❌ Error:", err.message || err);
    process.exit(1);
  }
}

addProteinFromFolder();
