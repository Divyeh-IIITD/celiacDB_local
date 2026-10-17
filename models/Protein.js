const mongoose = require("mongoose");

// Schema for individual uploaded files
const fileSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    type: { type: String, required: true }, // e.g., 'pdb', 'txt', etc.
    size: { type: Number, required: true }, // in bytes
    category: { type: String, required: true }, // e.g., 'image', 'metric', 'structure', 'complex_structure'
    content: { type: String }, // Optional: used for plain text previews
    parsedTable: [[String]], // Optional: parsed tabular content for metrics
  },
  { _id: false }
);

// Schema for docking result of a peptide
const dockingResultSchema = new mongoose.Schema(
  {
    peptideName: { type: String, required: true },
    dockedStructureFile: { type: String }, // Individual peptide PDB file (optional)
    complexStructureFile: { type: String }, // Protein+peptide complex PDB file (optional)
    logFile: { type: String, required: true }, // Docking log file
    logContent: { type: String }, // Raw log file content
    topResults: [
      {
        mode: Number,
        affinity: Number,
        rmsdLb: Number,
        rmsdUb: Number,
      },
    ],
    haddockMetrics: {
      haddockScore: Number,
      clusterRank: Number,
      clusterId: Number,
      irmsd: Number,
      fnat: Number,
      lrmsd: Number,
      dockq: Number,
      bsa: Number,
      elec: Number,
      vdw: Number,
      desolv: Number,
      totalEnergy: String,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const peptideLibrarySchema = new mongoose.Schema(
  {
    peptideName: { type: String, required: true },
    conformations: {
      ensemble: { type: String, required: true },
      helix: { type: String, required: true },
      ppii: { type: String, required: true },
      sheet: { type: String, required: true },
    },
  },
  { _id: false }
);

// Main protein schema
const proteinSchema = new mongoose.Schema({
  name: { type: String, required: true }, // Protein name
  analysis: { type: String }, // Optional description or interpretation
  files: [fileSchema], // All uploaded files related to the protein

  // Main docking-related fields
  mainProteinFile: { type: String }, // Stored filename of the main HLA-DQ PDB
  configFile: { type: String }, // Stored filename of the docking configuration file
  dockingResults: [dockingResultSchema], // All docking results for this protein
  peptideLibrary: [peptideLibrarySchema], // HADDOCK peptide conformations available for docking

  // Metadata
  uploadedAt: { type: Date, default: Date.now },
  totalPeptides: { type: Number, default: 0 },
  proteinType: { type: String, default: "HLADQ" }, // Default classification
});

module.exports = mongoose.model("Protein", proteinSchema);
