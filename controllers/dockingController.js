const Protein = require("../models/Protein");
const fs = require("fs").promises;
const path = require("path");
const archiver = require("archiver");

class DockingController {
  // Get docking form page (PAGE 2)
  async getDockingForm(req, res) {
    try {
      const proteins = await Protein.find({ proteinType: "HLADQ" });

      const allPeptides = new Set();
      proteins.forEach((protein) => {
        protein.dockingResults.forEach((result) => {
          allPeptides.add(result.peptideName);
        });
      });

      const peptides = Array.from(allPeptides).sort();

      res.render("docking-form", { proteins, peptides });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Internal Server Error");
    }
  }

  // Handle docking analysis form submission
  async submitDockingForm(req, res) {
    try {
      const { proteinId, peptideName } = req.body;

      if (!proteinId || !peptideName) {
        return res.status(400).send("Please select both protein and peptide");
      }

      res.redirect(
        `/docking-results/${proteinId}/${encodeURIComponent(peptideName)}`
      );
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Internal Server Error");
    }
  }

  // Get docking results (for pre-computed)
  async getDockingResults(req, res) {
    try {
      const { proteinId, peptideName } = req.params;

      const protein = await Protein.findById(proteinId).lean();
      if (!protein) {
        return res.status(404).send("Protein not found");
      }

      const dockingResult = protein.dockingResults.find(
        (result) => result.peptideName === peptideName
      );

      if (!dockingResult) {
        return res
          .status(404)
          .send("Docking result not found for this peptide");
      }

      const proteinPdb = protein.files.find(
        (f) => f.storedName === protein.mainProteinFile
      );

      const peptidePdb = protein.files.find(
        (f) => f.storedName === dockingResult.dockedStructureFile
      );

      const complexPdb =
        protein.files.find(
          (f) => f.storedName === dockingResult.complexStructureFile
        ) ||
        protein.files.find(
          (f) =>
            f.originalName.includes(
              `${protein.name.split(" ")[0]}_${peptideName}_complex.pdb`
            ) ||
            f.originalName.includes(`${peptideName}_complex.pdb`) ||
            (f.category === "complex_structure" &&
              f.originalName.toLowerCase().includes(peptideName.toLowerCase()))
        );

      // Use the unified docking-results.ejs with pre-computed data
      res.render("docking-results", {
        protein,
        dockingResult,
        proteinPdb,
        peptidePdb,
        complexPdb,
        peptideName,
        includeMolstar: true,
        // Set these to undefined for pre-computed docking
        dockingData: undefined,
        sessionId: undefined,
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Error loading docking results");
    }
  }

  // Download docking result files as ZIP
  async downloadDockingResults(req, res) {
    try {
      const { proteinId, peptideName } = req.params;

      const protein = await Protein.findById(proteinId);
      if (!protein) {
        return res.status(404).send("Protein not found");
      }

      const dockingResult = protein.dockingResults.find(
        (result) => result.peptideName === peptideName
      );

      if (!dockingResult) {
        return res
          .status(404)
          .send("Docking result not found for this peptide");
      }

      const zipFileName = `${protein.name.replace(
        /\s+/g,
        "_"
      )}_${peptideName}_docking_results.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${zipFileName}"`
      );

      const archive = archiver("zip", {
        zlib: { level: 9 },
      });

      archive.on("warning", (err) => {
        if (err.code === "ENOENT") {
          console.warn("Archive warning:", err);
        } else {
          console.error("Archive error:", err);
          throw err;
        }
      });

      archive.on("error", (err) => {
        console.error("Archive error:", err);
        res.status(500).send("Error creating ZIP file");
      });

      archive.pipe(res);

      const uploadsDir = path.join(__dirname, "../public/uploads");
      let filesAdded = 0;

      if (protein.mainProteinFile) {
        try {
          const proteinPath = path.join(uploadsDir, protein.mainProteinFile);
          await fs.access(proteinPath);

          const proteinFile = protein.files.find(
            (f) => f.storedName === protein.mainProteinFile
          );
          const proteinName = proteinFile
            ? proteinFile.originalName
            : `${protein.name}_protein.pdb`;

          archive.file(proteinPath, { name: proteinName });
          filesAdded++;
          console.log(`Added protein PDB: ${proteinName}`);
        } catch (err) {
          console.warn(`Could not add protein PDB: ${err.message}`);
        }
      }

      if (dockingResult.dockedStructureFile) {
        try {
          const peptidePath = path.join(
            uploadsDir,
            dockingResult.dockedStructureFile
          );
          await fs.access(peptidePath);

          const peptideFile = protein.files.find(
            (f) => f.storedName === dockingResult.dockedStructureFile
          );
          const peptideName = peptideFile
            ? peptideFile.originalName
            : `${peptideName}_peptide.pdb`;

          archive.file(peptidePath, { name: peptideName });
          filesAdded++;
          console.log(`Added peptide PDB: ${peptideName}`);
        } catch (err) {
          console.warn(`Could not add peptide PDB: ${err.message}`);
        }
      }

      if (dockingResult.complexStructureFile) {
        try {
          const complexPath = path.join(
            uploadsDir,
            dockingResult.complexStructureFile
          );
          await fs.access(complexPath);

          const complexFile = protein.files.find(
            (f) => f.storedName === dockingResult.complexStructureFile
          );
          const complexName = complexFile
            ? complexFile.originalName
            : `${peptideName}_complex.pdb`;

          archive.file(complexPath, { name: complexName });
          filesAdded++;
          console.log(`Added complex PDB: ${complexName}`);
        } catch (err) {
          console.warn(`Could not add complex PDB: ${err.message}`);
        }
      }

      if (dockingResult.logFile) {
        try {
          const logPath = path.join(uploadsDir, dockingResult.logFile);
          await fs.access(logPath);

          archive.file(logPath, { name: `${peptideName}_docking.log` });
          filesAdded++;
          console.log(`Added log file: ${peptideName}_docking.log`);
        } catch (err) {
          console.warn(`Could not add log file: ${err.message}`);
        }
      }

      if (protein.configFile) {
        try {
          const configPath = path.join(uploadsDir, protein.configFile);
          await fs.access(configPath);

          archive.file(configPath, { name: "docking_config.conf" });
          filesAdded++;
          console.log(`Added config file: docking_config.conf`);
        } catch (err) {
          console.warn(`Could not add config file: ${err.message}`);
        }
      }

      const readmeContent = `# Docking Results: ${
        protein.name
      } with ${peptideName}

## Overview
This package contains all files related to the molecular docking analysis between:
- **Protein**: ${protein.name}
- **Peptide**: ${peptideName}
- **Generated**: ${new Date().toISOString()}

## Files Included
${filesAdded > 0 ? "- Protein PDB structure" : ""}
${dockingResult.dockedStructureFile ? "- Peptide PDB structure" : ""}
${dockingResult.complexStructureFile ? "- Docked complex PDB structure" : ""}
${dockingResult.logFile ? "- Docking log file with scores and parameters" : ""}
${protein.configFile ? "- Configuration file used for docking" : ""}

## Docking Results Summary
- **Peptide**: ${peptideName}
- **Best Affinity**: ${
        dockingResult.bestScore || "See log file for detailed scores"
      }
- **Analysis**: Use molecular visualization software (PyMOL, ChimeraX, VMD) to examine the structures

## Analysis Notes
${protein.analysis || "No additional analysis notes available."}

## Usage Instructions
1. Load the protein PDB file in your molecular viewer
2. Load the peptide PDB file to see the individual structures
3. Load the complex PDB file to visualize the docked result
4. Refer to the log file for detailed scoring and RMSD values
5. Use the configuration file to understand docking parameters

## File Format Information
- **PDB files**: Protein Data Bank format for 3D molecular structures
- **LOG files**: Text files containing docking scores, RMSD values, and binding modes
- **CONF files**: Configuration files with docking parameters

---
Generated from HLA-DQ Protein-Peptide Docking Analysis Platform
`;

      archive.append(readmeContent, { name: "README.md" });

      console.log(
        `Creating docking results ZIP with ${filesAdded} files for: ${protein.name} + ${peptideName}`
      );
      archive.finalize();
    } catch (err) {
      console.error("Docking ZIP download error:", err);
      res.status(500).send("ZIP download failed");
    }
  }
}

module.exports = new DockingController();
