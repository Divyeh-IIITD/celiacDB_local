const peptidePrepService = require("../services/peptidePrepService");
const path = require("path");
const fs = require("fs").promises;
const PREP_SESSION_COOKIE = "celiacdb_prep_session";

class PeptidePrepController {
  async getPeptidePrepPage(req, res) {
    try {
      res.render("peptide-prep", {
        title: "Peptide Preparation & Ensemble Generator",
        includeMolstar: true,
        isPeptidePrep: true,
      });
    } catch (error) {
      console.error("Error rendering peptide prep page:", error);
      res.status(500).send("Internal Server Error");
    }
  }

  async generateConformers(req, res) {
    try {
      const { sequence } = req.body;
      if (!sequence) {
        return res.status(400).json({ success: false, error: "Peptide sequence is required" });
      }

      console.log(`🧬 Received request to generate conformers for sequence: ${sequence}`);
      const result = await peptidePrepService.generateConformers(sequence);
      res.setHeader(
        "Set-Cookie",
        `${PREP_SESSION_COOKIE}=${encodeURIComponent(result.sessionId)}; Max-Age=86400; Path=/; SameSite=Lax`
      );
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error("❌ Error generating conformers:", error);
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  async downloadConformer(req, res) {
    try {
      const { sessionId, type } = req.params;
      const validTypes = {
        helix: "peptide_helix.pdb",
        sheet: "peptide_sheet.pdb",
        ppii: "peptide_ppii.pdb",
        ensemble: "peptide_ens.pdb",
        overlay: "peptide_overlay.pdb",
      };

      const filename = validTypes[type];
      if (!filename) {
        return res.status(404).send("Invalid conformer type");
      }

      const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
      const filePath = path.join(__dirname, "../temp_results", safeSessionId, filename);

      try {
        await fs.access(filePath);
      } catch (_) {
        return res.status(404).send("File not found or expired");
      }

      res.download(filePath, filename);
    } catch (error) {
      console.error("Error downloading conformer:", error);
      res.status(500).send("Internal Server Error");
    }
  }
}

module.exports = new PeptidePrepController();
