const mongoose = require("mongoose");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const Protein = require("../models/Protein");
require("dotenv").config();

const SOURCE_ROOT = path.resolve(
  process.argv[2] || path.join(__dirname, "../data/HLA-DQ_Proteins")
);
const UPLOADS_DIR = path.join(__dirname, "../public/uploads");

function proteinNameFromDirectory(directoryName) {
  return directoryName.replace(/^HLA[-\s]?/i, "HLA ").replace(/_/g, " ");
}

async function copyUpload(sourcePath, category) {
  const extension = path.extname(sourcePath);
  const digest = crypto
    .createHash("sha1")
    .update(await fs.readFile(sourcePath))
    .digest("hex")
    .slice(0, 12);
  const storedName = `${digest}-${path.basename(sourcePath).replace(/\s+/g, "_")}`;
  const destination = path.join(UPLOADS_DIR, storedName);
  await fs.copyFile(sourcePath, destination);
  const stat = await fs.stat(sourcePath);
  return {
    originalName: path.basename(sourcePath),
    storedName,
    type: extension.slice(1).toLowerCase(),
    size: stat.size,
    category,
  };
}

async function importProtein(directoryEntry) {
  const directory = path.join(SOURCE_ROOT, directoryEntry.name);
  const sourceFiles = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name));
  const pdbPath = sourceFiles.find((file) => path.extname(file).toLowerCase() === ".pdb");
  const configPath = sourceFiles.find((file) => /conf/i.test(path.basename(file)));

  if (!pdbPath) {
    console.warn(`Skipping ${directoryEntry.name}: no PDB file found`);
    return false;
  }

  const name = proteinNameFromDirectory(directoryEntry.name);
  const existing = await Protein.findOne({ name });
  const files = existing?.files ? [...existing.files] : [];

  const addFile = async (sourcePath, category) => {
    const metadata = await copyUpload(sourcePath, category);
    const index = files.findIndex((file) => file.originalName === metadata.originalName);
    if (index >= 0) files[index] = metadata;
    else files.push(metadata);
    return metadata.storedName;
  };

  const mainProteinFile = await addFile(pdbPath, "main_protein");
  const configFile = configPath ? await addFile(configPath, "config") : existing?.configFile || null;

  await Protein.findOneAndUpdate(
    { name },
    {
      $set: {
        analysis: `Comprehensive data for the ${name} protein including structure, docking, and complex structures.`,
        files,
        mainProteinFile,
        configFile,
        proteinType: "HLADQ",
      },
      $setOnInsert: {
        uploadedAt: new Date(),
        dockingResults: [],
        totalPeptides: 0,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  console.log(`Imported protein ${name}`);
  return true;
}

async function main() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const entries = (await fs.readdir(SOURCE_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    let imported = 0;
    for (const entry of entries) {
      if (await importProtein(entry)) imported++;
    }
    console.log(`Imported ${imported} HLA-DQ protein record(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("HLA-DQ import failed:", error.message);
  process.exitCode = 1;
});
