const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

class PeptidePrepService {
  constructor() {
    this.pymolPythonPath = this.detectPyMOLPython();
    this.toolsScriptPath = path.join(__dirname, "../tools/build_peptide_conformers.py");
  }

  detectPyMOLPython() {
    const candidates = [
      "C:\\Users\\Divyeh\\AppData\\Local\\Schrodinger\\PyMOL2\\python.exe",
      process.env.PYMOL_PYTHON,
      "python",
    ].filter(Boolean);

    for (const p of candidates) {
      try {
        const fsSync = require("fs");
        if (fsSync.existsSync(p)) {
          return p;
        }
      } catch (_) {}
    }
    return "python";
  }

  validateSequence(sequence) {
    if (typeof sequence !== "string") {
      throw new Error("Peptide sequence must be a string");
    }
    const cleanSeq = sequence.replace(/\s+/g, "").toUpperCase();
    if (!cleanSeq) {
      throw new Error("Peptide sequence cannot be empty");
    }
    if (cleanSeq.length < 3 || cleanSeq.length > 50) {
      throw new Error(`Peptide sequence length must be between 3 and 50 residues (got ${cleanSeq.length})`);
    }
    const validAminoAcids = /^[ACDEFGHIKLMNPQRSTVWY]+$/;
    if (!validAminoAcids.test(cleanSeq)) {
      const invalidChars = cleanSeq.split("").filter((c) => !"ACDEFGHIKLMNPQRSTVWY".includes(c));
      throw new Error(`Sequence contains invalid amino acid characters: ${[...new Set(invalidChars)].join(", ")}`);
    }
    return cleanSeq;
  }

  async generateConformers(sequence, sessionId = null) {
    const cleanSeq = this.validateSequence(sequence);
    const sid = sessionId || `prep_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const outputDir = path.join(__dirname, "../temp_results", sid);

    await fs.mkdir(outputDir, { recursive: true });

    const pyCmd = `"${this.pymolPythonPath}" "${this.toolsScriptPath}" ${cleanSeq} --output-dir "${outputDir}" --json`;
    console.log(`🧬 Generating peptide conformers with PyMOL: ${pyCmd}`);

    const execOptions = {
      timeout: 60000,
      windowsHide: true,
    };

    const { stdout, stderr } = await execAsync(pyCmd, execOptions);
    if (stderr && stderr.includes("Error")) {
      console.warn("⚠️ PyMOL warnings/stderr:", stderr);
    }

    let parsedResult;
    try {
      // Find JSON object in stdout
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not parse JSON output from conformer generator");
      }
      parsedResult = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      throw new Error(`Failed to parse conformer builder output: ${stdout || stderr}`);
    }

    if (!parsedResult.success) {
      throw new Error(parsedResult.error || "Conformer generation failed");
    }

    // Save metadata for the session
    const metaData = {
      sessionId: sid,
      sequence: cleanSeq,
      length: cleanSeq.length,
      createdAt: new Date().toISOString(),
      files: {
        helix: `temp-results/${sid}/peptide_helix.pdb`,
        sheet: `temp-results/${sid}/peptide_sheet.pdb`,
        ppii: `temp-results/${sid}/peptide_ppii.pdb`,
        ensemble: `temp-results/${sid}/peptide_ens.pdb`,
        overlay: `temp-results/${sid}/peptide_overlay.pdb`,
      },
    };

    await fs.writeFile(path.join(outputDir, "session_info.json"), JSON.stringify(metaData, null, 2));

    return metaData;
  }
}

module.exports = new PeptidePrepService();
