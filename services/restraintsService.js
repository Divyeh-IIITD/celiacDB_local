const path = require("path");
const fs = require("fs").promises;
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

class RestraintsService {
  constructor() {
    this.pythonPath = "python";
    this.scriptPath = path.join(__dirname, "../tools/generate_ambiguous_restraints.py");

    // Standard binding pocket residues for HLA-DQ alleles
    this.defaultPocketResidues = {
      "HLA-DQ2.2": [135, 165, 435],
      "HLA-DQ2.5": [135, 165, 435],
      "HLA-DQ4": [135, 165, 435],
      "HLA-DQ5": [135, 165, 435],
      "HLA-DQ6": [135, 165, 435],
      "HLA-DQ7": [135, 165, 435],
      "HLA-DQ8": [135, 165, 435],
      "HLA-DQ9": [135, 165, 435],
    };
  }

  getDefaultReceptorResidues(proteinName) {
    if (!proteinName) return [135, 165, 435];
    const norm = proteinName.replace(/\s+/g, "-").toUpperCase();
    for (const [key, val] of Object.entries(this.defaultPocketResidues)) {
      if (norm.includes(key.toUpperCase())) {
        return val;
      }
    }
    return [135, 165, 435];
  }

  getDefaultPeptideResidues(peptideLength) {
    const len = parseInt(peptideLength) || 15;
    return Array.from({ length: len }, (_, i) => i + 1);
  }

  parseResidueString(str) {
    if (!str) return [];
    const tokens = str.toString().split(/[,;\s]+/);
    const result = new Set();

    for (const token of tokens) {
      if (!token) continue;
      const match = token.match(/^(\d+)\s*(?:-|to)\s*(\d+)$/i);
      if (match) {
        let start = parseInt(match[1]);
        let end = parseInt(match[2]);
        if (start > end) [start, end] = [end, start];
        for (let i = start; i <= end; i++) result.add(i);
      } else if (/^\d+$/.test(token)) {
        result.add(parseInt(token));
      }
    }
    return Array.from(result).sort((a, b) => a - b);
  }

  async generateTblFile(receptorResidues, peptideResidues, outputFilePath, options = {}) {
    const recSeg = options.receptorSegid || "A";
    const pepSeg = options.peptideSegid || "B";

    const recList = Array.isArray(receptorResidues) ? receptorResidues : this.parseResidueString(receptorResidues);
    const pepList = Array.isArray(peptideResidues) ? peptideResidues : this.parseResidueString(peptideResidues);

    if (recList.length === 0) {
      throw new Error("At least one active receptor residue must be defined");
    }
    if (pepList.length === 0) {
      throw new Error("At least one active peptide residue must be defined");
    }

    const lines = [
      "! ====================================================================",
      "! HADDOCK Ambiguous Interaction Restraints (AIR)",
      `! Receptor segid ${recSeg}: [${recList.join(", ")}]`,
      `! Peptide segid ${pepSeg}: [${pepList.join(", ")}]`,
      "! ====================================================================",
      "",
    ];

    const pepOr = pepList.map((r) => `resid ${r}`).join(" or ");
    for (const rec of recList) {
      lines.push(`assign (segid ${recSeg} and resid ${rec})`);
      lines.push(`       (segid ${pepSeg} and (${pepOr}))`);
      lines.push("       2.0 2.0 0.0\n");
    }

    const content = lines.join("\n");
    if (outputFilePath) {
      await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
      await fs.writeFile(outputFilePath, content, "ascii");
    }
    return content;
  }
}

module.exports = new RestraintsService();
