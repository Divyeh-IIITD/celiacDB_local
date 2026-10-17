const mongoose = require("mongoose");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const zlib = require("zlib");
require("dotenv").config();

const Protein = require("../models/Protein");
const SOURCE_ROOT = path.resolve(
  process.argv[2] || path.join(__dirname, "../precomputed_haddock")
);
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");

const PROTEIN_NAMES = {
  "DQ2.2": /HLA[-\s]?DQ2\.2/i,
  "DQ2.5": /HLA[-\s]?DQ2\.5/i,
  DQ4: /HLA[-\s]?DQ4/i,
  DQ5: /HLA[-\s]?DQ5/i,
  DQ6: /HLA[-\s]?DQ6/i,
  DQ7: /HLA[-\s]?DQ7/i,
  DQ8: /HLA[-\s]?DQ8/i,
  DQ9: /HLA[-\s]?DQ9/i,
};

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(filePath));
    else files.push(filePath);
  }
  return files;
}

function findFile(files, pattern) {
  return files.find((file) => pattern.test(path.basename(file)));
}

function parseNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function parseCapri(fileContent) {
  const lines = fileContent
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("cluster_rank"));
  if (!lines.length) return null;

  const columns = lines[0].split(/\t|\s+/).filter(Boolean);
  const value = (index) => parseNumber(columns[index]);
  const metrics = {
    haddockScore: value(4),
    clusterRank: Number.parseInt(columns[0], 10),
    clusterId: Number.parseInt(columns[1], 10),
    irmsd: value(6),
    fnat: value(8),
    lrmsd: value(10),
    dockq: value(12),
    bsa: value(20),
    desolv: value(22),
    elec: value(24),
    vdw: value(28),
  };
  if (!Number.isFinite(metrics.haddockScore)) return null;
  metrics.totalEnergy = Number.isFinite(metrics.elec) && Number.isFinite(metrics.vdw)
    ? (metrics.elec + metrics.vdw).toFixed(2)
    : null;
  return metrics;
}

async function copyUpload(sourcePath, prefix) {
  const extension = path.extname(sourcePath) || ".dat";
  const storedName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${extension}`;
  const destination = path.join(UPLOADS_DIR, storedName);
  await fs.copyFile(sourcePath, destination);
  const stat = await fs.stat(sourcePath);
  return {
    storedName,
    size: stat.size,
    originalName: path.basename(sourcePath),
  };
}

async function copyGzipUpload(sourcePath, prefix) {
  const storedName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdb`;
  const destination = path.join(UPLOADS_DIR, storedName);
  await fs.writeFile(destination, zlib.gunzipSync(await fs.readFile(sourcePath)));
  const stat = await fs.stat(destination);
  return { storedName, size: stat.size, originalName: path.basename(sourcePath, ".gz") };
}

async function importDataset(dqName, protein, datasetPath) {
  const files = await walk(datasetPath);
  const capriPath = files.find((file) => path.basename(file) === "capri_clt.tsv");
  if (!capriPath) {
    console.warn(`Skipping ${dqName}: capri_clt.tsv not found in ${datasetPath}`);
    return 0;
  }

  const metrics = parseCapri(await fs.readFile(capriPath, "utf8"));
  if (!metrics) {
    console.warn(`Skipping ${dqName}: unable to parse ${capriPath}`);
    return 0;
  }

  const modelPath = findFile(files, /^cluster_\d+_model_1\.pdb\.gz$/i)
    || findFile(files, /\.pdb\.gz$/i);
  if (!modelPath) {
    console.warn(`Skipping ${dqName}: no selected PDB model found`);
    return 0;
  }

  const logPath = findFile(files, /^(log|haddock.*)\b/i);
  const model = modelPath.endsWith(".gz")
    ? await copyGzipUpload(modelPath, dqName.toLowerCase().replace(/\W+/g, "_"))
    : await copyUpload(modelPath, dqName.toLowerCase().replace(/\W+/g, "_"));
  const log = logPath
    ? await copyUpload(logPath, `${dqName.toLowerCase()}_haddock_log`)
    : null;

  const peptideName = path.basename(datasetPath);
  const result = {
    peptideName,
    complexStructureFile: model.storedName,
    logFile: log ? log.storedName : model.storedName,
    logContent: logPath ? (await fs.readFile(logPath, "utf8")).slice(0, 10000) : "",
    topResults: [{
      mode: metrics.clusterRank || 1,
      affinity: metrics.haddockScore,
      rmsdLb: metrics.irmsd,
      rmsdUb: metrics.lrmsd,
    }],
    haddockMetrics: metrics,
    createdAt: new Date(),
  };

  const existing = protein.dockingResults.findIndex((item) => item.peptideName === peptideName);
  if (existing >= 0) protein.dockingResults[existing] = result;
  else protein.dockingResults.push(result);

  protein.files.push({
    originalName: model.originalName,
    storedName: model.storedName,
    type: "pdb",
    size: model.size,
    category: "complex_structure",
  });
  if (log) {
    protein.files.push({
      originalName: log.originalName,
      storedName: log.storedName,
      type: "log",
      size: log.size,
      category: "docking_log",
      content: result.logContent.slice(0, 5000),
    });
  }
  return 1;
}

async function findDatasetDirectories(directory) {
  const files = await walk(directory);
  const capriFiles = files.filter((file) => path.basename(file) === "capri_clt.tsv");
  return capriFiles.map((file) => path.dirname(path.dirname(path.dirname(file))));
}

async function main() {
  if (!fsSync.existsSync(SOURCE_ROOT)) {
    throw new Error(`Precomputed HADDOCK directory not found: ${SOURCE_ROOT}`);
  }
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const entries = await fs.readdir(SOURCE_ROOT, { withFileTypes: true });
    let imported = 0;
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const protein = await Protein.findOne({
        name: PROTEIN_NAMES[entry.name] || new RegExp(entry.name.replace(".", "\\."), "i"),
      });
      if (!protein) {
        console.warn(`No database protein matches ${entry.name}; skipping`);
        continue;
      }
      const proteinRoot = path.join(SOURCE_ROOT, entry.name);
      const datasetPaths = await findDatasetDirectories(proteinRoot);
      for (const datasetPath of datasetPaths) {
        imported += await importDataset(
          entry.name,
          protein,
          datasetPath
        );
      }
      protein.totalPeptides = protein.dockingResults.length;
      await protein.save();
      console.log(`${protein.name}: imported ${protein.totalPeptides} precomputed result(s)`);
    }
    console.log(`Imported ${imported} HADDOCK dataset(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Precomputed HADDOCK import failed:", error.message);
  process.exitCode = 1;
});
