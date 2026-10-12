const Protein = require("../models/Protein");
const fs = require("fs").promises;
const path = require("path");
const archiver = require("archiver");

class ProteinController {
  // Home page with 3 main options
  async getHomePage(req, res) {
    try {
      const proteins = await Protein.find();
      res.render("index", { proteins });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Internal Server Error");
    }
  }

  // Get all HLADQ proteins
  async getAllProteins(req, res) {
    try {
      const proteins = await Protein.find();
      console.log(`Found ${proteins.length} proteins for HLADQ page`);
      res.render("hladq-proteins", { proteins });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Internal Server Error");
    }
  }

  // Get individual protein details
  async getProteinDetails(req, res) {
    try {
      const protein = await Protein.findById(req.params.id).lean();
      if (!protein) {
        return res.status(404).send("Protein not found");
      }

      // Load contents of metric files
      for (const file of protein.files) {
        if (["area", "thickness", "txt"].includes(file.type)) {
          const fullPath = path.join(
            __dirname,
            "../public/uploads",
            file.storedName
          );
          try {
            file.content = await fs.readFile(fullPath, "utf-8");
          } catch (err) {
            console.warn(`Could not read file: ${file.originalName}`);
            file.content = "[Could not read file content]";
          }
        }
      }

      res.render("hladq-protein-details", { protein });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Error fetching protein details");
    }
  }

  // Download protein PDB file
  async downloadProtein(req, res) {
    try {
      const protein = await Protein.findById(req.params.id);
      if (!protein || !protein.mainProteinFile) {
        return res.status(404).send("Protein file not found");
      }

      const filePath = path.join(
        __dirname,
        "../public/uploads",
        protein.mainProteinFile
      );
      const fileName = `${protein.name.replace(/\s+/g, "_")}.pdb`;

      res.download(filePath, fileName);
    } catch (err) {
      console.error("Download error:", err);
      res.status(500).send("Download failed");
    }
  }

  // Download all protein files as ZIP
  async downloadAllFiles(req, res) {
    try {
      const protein = await Protein.findById(req.params.id);
      if (!protein) {
        return res.status(404).send("Protein not found");
      }

      const zipFileName = `${protein.name.replace(/\s+/g, "_")}_all_files.zip`;
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

      for (const file of protein.files) {
        try {
          const filePath = path.join(uploadsDir, file.storedName);
          await fs.access(filePath);
          archive.file(filePath, { name: file.originalName });
          filesAdded++;
          console.log(`Added to ZIP: ${file.originalName}`);
        } catch (err) {
          console.warn(
            `Could not add file to ZIP: ${file.originalName}`,
            err.message
          );
        }
      }

      const readmeContent = `# ${protein.name} - Files Package

## Protein Information
- Name: ${protein.name}
- Type: ${protein.proteinType || "HLA-DQ"}
- Files included: ${filesAdded}
- Generated: ${new Date().toISOString()}

## Description
${protein.analysis || "No analysis available."}

## Docking Results
${
  protein.dockingResults && protein.dockingResults.length > 0
    ? protein.dockingResults
        .map((result) => `- ${result.peptideName}`)
        .join("\n")
    : "No docking results available."
}

---
Downloaded from Celiac DB
`;

      archive.append(readmeContent, { name: "README.md" });
      console.log(
        `Creating ZIP with ${filesAdded} files for protein: ${protein.name}`
      );
      archive.finalize();
    } catch (err) {
      console.error("ZIP download error:", err);
      res.status(500).send("ZIP download failed");
    }
  }
}

module.exports = new ProteinController();
