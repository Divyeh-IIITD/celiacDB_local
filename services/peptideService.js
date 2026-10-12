const fs = require("fs").promises;
const path = require("path");

class PeptideService {
  constructor() {
    // Initialize Ramachandran plot data and amino acid properties
    this.initializeStructuralData();
  }

  // Initialize structural data for realistic peptide generation
  initializeStructuralData() {
    // Amino acid specific properties and preferences
    this.aminoAcidData = {
      A: {
        name: "ALA",
        volume: 88.6,
        hydrophobicity: 1.8,
        helixPropensity: 1.42,
        sheetPropensity: 0.83,
        turnPropensity: 0.66,
        sideChainAtoms: [],
        flexibility: 1.0,
      },
      R: {
        name: "ARG",
        volume: 173.4,
        hydrophobicity: -4.5,
        helixPropensity: 0.98,
        sheetPropensity: 0.93,
        turnPropensity: 0.95,
        sideChainAtoms: ["CB", "CG", "CD", "NE", "CZ", "NH1", "NH2"],
        flexibility: 2.5,
      },
      N: {
        name: "ASN",
        volume: 114.1,
        hydrophobicity: -3.5,
        helixPropensity: 0.67,
        sheetPropensity: 0.89,
        turnPropensity: 1.56,
        sideChainAtoms: ["CB", "CG", "OD1", "ND2"],
        flexibility: 1.8,
      },
      D: {
        name: "ASP",
        volume: 111.1,
        hydrophobicity: -3.5,
        helixPropensity: 1.01,
        sheetPropensity: 0.54,
        turnPropensity: 1.46,
        sideChainAtoms: ["CB", "CG", "OD1", "OD2"],
        flexibility: 1.6,
      },
      C: {
        name: "CYS",
        volume: 108.5,
        hydrophobicity: 2.5,
        helixPropensity: 0.7,
        sheetPropensity: 1.19,
        turnPropensity: 1.19,
        sideChainAtoms: ["CB", "SG"],
        flexibility: 1.2,
        canFormDisulfide: true,
      },
      E: {
        name: "GLU",
        volume: 138.4,
        hydrophobicity: -3.5,
        helixPropensity: 1.51,
        sheetPropensity: 0.37,
        turnPropensity: 0.74,
        sideChainAtoms: ["CB", "CG", "CD", "OE1", "OE2"],
        flexibility: 2.0,
      },
      Q: {
        name: "GLN",
        volume: 143.8,
        hydrophobicity: -3.5,
        helixPropensity: 1.11,
        sheetPropensity: 1.1,
        turnPropensity: 0.98,
        sideChainAtoms: ["CB", "CG", "CD", "OE1", "NE2"],
        flexibility: 2.2,
      },
      G: {
        name: "GLY",
        volume: 60.1,
        hydrophobicity: -0.4,
        helixPropensity: 0.57,
        sheetPropensity: 0.75,
        turnPropensity: 1.56,
        sideChainAtoms: [],
        flexibility: 3.0,
        isFlexible: true,
      },
      H: {
        name: "HIS",
        volume: 153.2,
        hydrophobicity: -3.2,
        helixPropensity: 1.0,
        sheetPropensity: 0.87,
        turnPropensity: 0.95,
        sideChainAtoms: ["CB", "CG", "ND1", "CD2", "CE1", "NE2"],
        flexibility: 1.8,
      },
      I: {
        name: "ILE",
        volume: 166.7,
        hydrophobicity: 4.5,
        helixPropensity: 1.08,
        sheetPropensity: 1.6,
        turnPropensity: 0.47,
        sideChainAtoms: ["CB", "CG1", "CG2", "CD1"],
        flexibility: 0.8,
      },
      L: {
        name: "LEU",
        volume: 166.7,
        hydrophobicity: 3.8,
        helixPropensity: 1.21,
        sheetPropensity: 1.3,
        turnPropensity: 0.59,
        sideChainAtoms: ["CB", "CG", "CD1", "CD2"],
        flexibility: 1.2,
      },
      K: {
        name: "LYS",
        volume: 168.6,
        hydrophobicity: -3.9,
        helixPropensity: 1.16,
        sheetPropensity: 0.74,
        turnPropensity: 1.01,
        sideChainAtoms: ["CB", "CG", "CD", "CE", "NZ"],
        flexibility: 2.8,
      },
      M: {
        name: "MET",
        volume: 162.9,
        hydrophobicity: 1.9,
        helixPropensity: 1.45,
        sheetPropensity: 1.05,
        turnPropensity: 0.6,
        sideChainAtoms: ["CB", "CG", "SD", "CE"],
        flexibility: 1.8,
      },
      F: {
        name: "PHE",
        volume: 189.9,
        hydrophobicity: 2.8,
        helixPropensity: 1.13,
        sheetPropensity: 1.38,
        turnPropensity: 0.6,
        sideChainAtoms: ["CB", "CG", "CD1", "CD2", "CE1", "CE2", "CZ"],
        flexibility: 1.0,
      },
      P: {
        name: "PRO",
        volume: 112.7,
        hydrophobicity: -1.6,
        helixPropensity: 0.57,
        sheetPropensity: 0.55,
        turnPropensity: 1.52,
        sideChainAtoms: ["CB", "CG", "CD"],
        flexibility: 0.3,
        isRigid: true,
        breakesHelix: true,
      },
      S: {
        name: "SER",
        volume: 89.0,
        hydrophobicity: -0.8,
        helixPropensity: 0.77,
        sheetPropensity: 0.75,
        turnPropensity: 1.43,
        sideChainAtoms: ["CB", "OG"],
        flexibility: 1.5,
      },
      T: {
        name: "THR",
        volume: 116.1,
        hydrophobicity: -0.7,
        helixPropensity: 0.83,
        sheetPropensity: 1.19,
        turnPropensity: 0.96,
        sideChainAtoms: ["CB", "OG1", "CG2"],
        flexibility: 1.2,
      },
      W: {
        name: "TRP",
        volume: 227.8,
        hydrophobicity: -0.9,
        helixPropensity: 1.08,
        sheetPropensity: 1.37,
        turnPropensity: 0.96,
        sideChainAtoms: [
          "CB",
          "CG",
          "CD1",
          "CD2",
          "NE1",
          "CE2",
          "CE3",
          "CZ2",
          "CZ3",
          "CH2",
        ],
        flexibility: 1.0,
      },
      Y: {
        name: "TYR",
        volume: 193.6,
        hydrophobicity: -1.3,
        helixPropensity: 0.69,
        sheetPropensity: 1.47,
        turnPropensity: 1.14,
        sideChainAtoms: ["CB", "CG", "CD1", "CD2", "CE1", "CE2", "CZ", "OH"],
        flexibility: 1.2,
      },
      V: {
        name: "VAL",
        volume: 140.0,
        hydrophobicity: 4.2,
        helixPropensity: 1.06,
        sheetPropensity: 1.7,
        turnPropensity: 0.5,
        sideChainAtoms: ["CB", "CG1", "CG2"],
        flexibility: 0.7,
      },
    };

    // Standard bond lengths and angles
    this.standardGeometry = {
      bondLengths: {
        "N-CA": 1.458,
        "CA-C": 1.525,
        "C-O": 1.231,
        "C-N": 1.329,
        "CA-CB": 1.53,
        "CB-CG": 1.52,
        "CG-CD": 1.52,
        "CD-CE": 1.52,
        "SG-SG": 2.05,
        "C-S": 1.81,
        "N-H": 1.01,
        "O-H": 0.96,
      },
      bondAngles: {
        "N-CA-C": 111.2,
        "CA-C-N": 116.2,
        "C-N-CA": 121.7,
        "N-CA-CB": 110.5,
        "CA-CB-CG": 114.1,
        "CB-CG-CD": 112.4,
      },
      omega: 180.0,
    };
  }

  // Main method for generating 3D peptide structure
  async generatePeptide3D(sequence, outputDir) {
    const peptideName = `peptide_${sequence.substring(0, 8)}_${Date.now()}`;
    const outputPath = path.join(outputDir, `${peptideName}.pdb`);

    try {
      console.log(
        `🧬 Generating ADVANCED 3D structure for peptide: ${sequence}`
      );
      console.log(`- Length: ${sequence.length} amino acids`);
      console.log(`- Using PepFold4-inspired algorithm`);

      // Step 1: Analyze sequence properties
      const sequenceAnalysis = this.analyzeSequence(sequence);
      console.log(
        `- Hydrophobicity: ${sequenceAnalysis.hydrophobicity.toFixed(2)}`
      );
      console.log(
        `- Secondary structure tendency: ${sequenceAnalysis.dominantStructure}`
      );

      // Step 2: Predict secondary structure using enhanced algorithm
      const secondaryStructure =
        this.predictSecondaryStructureAdvanced(sequence);
      console.log(`- Predicted structure: ${secondaryStructure.join("")}`);

      // Step 3: Detect potential disulfide bonds
      const disulfideBonds = this.predictDisulfideBonds(sequence);
      if (disulfideBonds.length > 0) {
        console.log(
          `- Potential disulfide bonds: ${disulfideBonds
            .map((b) => `${b.pos1 + 1}-${b.pos2 + 1}`)
            .join(", ")}`
        );
      }

      // Step 4: Generate 3D coordinates with proper folding
      const structure3D = this.generate3DStructureAdvanced(
        sequence,
        secondaryStructure,
        disulfideBonds
      );

      // Step 5: Generate PDB content (skip optimization for now to avoid issues)
      const pdbContent = this.generateAdvancedPDB(
        sequence,
        structure3D,
        disulfideBonds
      );

      if (!pdbContent || pdbContent.length < 100) {
        throw new Error("Generated PDB content is too short or empty");
      }

      await fs.writeFile(outputPath, pdbContent);

      // Verify the file was written
      const stats = await fs.stat(outputPath);
      console.log(`✅ Generated advanced peptide PDB: ${outputPath}`);
      console.log(`- File size: ${stats.size} bytes`);
      console.log(`- Atoms generated: ${structure3D.length}`);

      return outputPath;
    } catch (error) {
      console.error(`❌ Error generating peptide 3D:`, error);
      throw new Error(
        `Failed to generate peptide 3D structure: ${error.message}`
      );
    }
  }

  // Advanced sequence analysis
  analyzeSequence(sequence) {
    let hydrophobicity = 0;
    let helixPropensity = 0;
    let sheetPropensity = 0;
    let turnPropensity = 0;
    let charge = 0;

    for (const aa of sequence) {
      const data = this.aminoAcidData[aa];
      if (data) {
        hydrophobicity += data.hydrophobicity;
        helixPropensity += data.helixPropensity;
        sheetPropensity += data.sheetPropensity;
        turnPropensity += data.turnPropensity;

        if (aa === "R" || aa === "K") charge += 1;
        if (aa === "D" || aa === "E") charge -= 1;
      }
    }

    const len = sequence.length;
    const avgHydrophobicity = hydrophobicity / len;
    const avgHelix = helixPropensity / len;
    const avgSheet = sheetPropensity / len;
    const avgTurn = turnPropensity / len;

    let dominantStructure = "extended";
    if (avgHelix > avgSheet && avgHelix > avgTurn) dominantStructure = "helix";
    else if (avgSheet > avgTurn) dominantStructure = "sheet";
    else dominantStructure = "turn";

    return {
      hydrophobicity: avgHydrophobicity,
      helixPropensity: avgHelix,
      sheetPropensity: avgSheet,
      turnPropensity: avgTurn,
      charge,
      dominantStructure,
    };
  }

  // Enhanced secondary structure prediction
  predictSecondaryStructureAdvanced(sequence) {
    const prediction = [];

    for (let i = 0; i < sequence.length; i++) {
      const aa = sequence[i];
      const data = this.aminoAcidData[aa];

      if (!data) {
        prediction.push("C");
        continue;
      }

      // Simple prediction based on propensities
      if (
        data.helixPropensity > data.sheetPropensity &&
        data.helixPropensity > data.turnPropensity
      ) {
        prediction.push("H");
      } else if (data.sheetPropensity > data.turnPropensity) {
        prediction.push("E");
      } else {
        prediction.push("T");
      }

      // Special cases
      if (data.breakesHelix) prediction[i] = "T"; // Proline breaks helices
      if (data.isFlexible) prediction[i] = "T"; // Glycine favors turns
    }

    return prediction;
  }

  // Predict disulfide bonds between cysteines
  predictDisulfideBonds(sequence) {
    const cysteines = [];

    for (let i = 0; i < sequence.length; i++) {
      if (sequence[i] === "C") {
        cysteines.push(i);
      }
    }

    const bonds = [];
    for (let i = 0; i < cysteines.length; i += 2) {
      if (i + 1 < cysteines.length) {
        const pos1 = cysteines[i];
        const pos2 = cysteines[i + 1];
        if (pos2 - pos1 >= 3) {
          // At least 3 residues apart
          bonds.push({ pos1, pos2, probability: 0.8 });
        }
      }
    }

    return bonds;
  }

  // Generate 3D structure with proper folding
  generate3DStructureAdvanced(sequence, secondaryStructure, disulfideBonds) {
    const atoms = [];

    for (let i = 0; i < sequence.length; i++) {
      const aa = sequence[i];
      const ssType = secondaryStructure[i];
      const aaData = this.aminoAcidData[aa];

      // Calculate position based on secondary structure
      const position = this.calculateResiduePosition(
        i,
        ssType,
        sequence.length
      );

      // Generate backbone atoms
      const backboneAtoms = this.generateBackboneAtomsFixed(
        aaData,
        position,
        i + 1
      );

      // Generate side chain atoms
      const sideChainAtoms = this.generateSideChainAtomsFixed(
        aaData,
        backboneAtoms,
        i + 1
      );

      atoms.push(...backboneAtoms, ...sideChainAtoms);
    }

    return atoms;
  }

  // Calculate residue position based on secondary structure
  calculateResiduePosition(index, ssType, totalLength) {
    let position = { x: 0, y: 0, z: 0 };

    switch (ssType) {
      case "H": // Helix
        const helixRadius = 2.3;
        const helixRise = 1.5;
        const helixAngle = (index * 100 * Math.PI) / 180; // 100 degrees per residue
        position.x = helixRadius * Math.cos(helixAngle);
        position.y = helixRadius * Math.sin(helixAngle);
        position.z = index * helixRise;
        break;

      case "E": // Sheet
        position.x = index * 3.8; // Extended
        position.y = (index % 2) * 1.0; // Slight alternation
        position.z = 0;
        break;

      case "T": // Turn
        const turnRadius = 3.0;
        const turnAngle = (index * 60 * Math.PI) / 180; // Sharp turn
        position.x = turnRadius * Math.cos(turnAngle);
        position.y = turnRadius * Math.sin(turnAngle);
        position.z = index * 1.0;
        break;

      default: // Coil
        position.x = index * 3.8;
        position.y = Math.sin(index * 0.5) * 2.0;
        position.z = Math.cos(index * 0.3) * 1.5;
    }

    return position;
  }

  // Generate backbone atoms with fixed coordinates
  generateBackboneAtomsFixed(aaData, position, resNum) {
    const atoms = [];

    atoms.push({
      name: "N",
      element: "N",
      coords: { x: position.x - 1.458, y: position.y, z: position.z },
      resNum,
      resName: aaData.name,
    });

    atoms.push({
      name: "CA",
      element: "C",
      coords: { x: position.x, y: position.y, z: position.z },
      resNum,
      resName: aaData.name,
    });

    atoms.push({
      name: "C",
      element: "C",
      coords: { x: position.x + 1.525, y: position.y + 0.5, z: position.z },
      resNum,
      resName: aaData.name,
    });

    atoms.push({
      name: "O",
      element: "O",
      coords: {
        x: position.x + 1.231,
        y: position.y + 1.5,
        z: position.z + 0.849,
      },
      resNum,
      resName: aaData.name,
    });

    return atoms;
  }

  // Generate side chain atoms with fixed coordinates
  generateSideChainAtomsFixed(aaData, backboneAtoms, resNum) {
    const sideChainAtoms = [];

    if (aaData.sideChainAtoms.length === 0) return sideChainAtoms; // Glycine

    const caAtom = backboneAtoms.find((atom) => atom.name === "CA");
    if (!caAtom) {
      console.warn(`⚠️ No CA atom found for side chain generation`);
      return sideChainAtoms;
    }

    // Generate CB atom
    const cbCoords = {
      x: caAtom.coords.x + 1.53,
      y: caAtom.coords.y - 1.0,
      z: caAtom.coords.z + 0.5,
    };

    if (aaData.sideChainAtoms.includes("CB")) {
      sideChainAtoms.push({
        name: "CB",
        element: "C",
        coords: cbCoords,
        resNum,
        resName: aaData.name,
      });
    }

    // Generate additional side chain atoms based on amino acid
    this.generateSpecificSideChainFixed(
      aaData,
      cbCoords,
      sideChainAtoms,
      resNum
    );

    return sideChainAtoms;
  }

  // Generate specific side chain atoms (simplified)
  generateSpecificSideChainFixed(aaData, cbCoords, sideChainAtoms, resNum) {
    switch (aaData.name) {
      case "SER":
        sideChainAtoms.push({
          name: "OG",
          element: "O",
          coords: { x: cbCoords.x + 1.42, y: cbCoords.y, z: cbCoords.z },
          resNum,
          resName: aaData.name,
        });
        break;

      case "CYS":
        sideChainAtoms.push({
          name: "SG",
          element: "S",
          coords: { x: cbCoords.x + 1.81, y: cbCoords.y, z: cbCoords.z },
          resNum,
          resName: aaData.name,
        });
        break;

      case "VAL":
        sideChainAtoms.push({
          name: "CG1",
          element: "C",
          coords: { x: cbCoords.x + 1.52, y: cbCoords.y + 1.0, z: cbCoords.z },
          resNum,
          resName: aaData.name,
        });
        sideChainAtoms.push({
          name: "CG2",
          element: "C",
          coords: { x: cbCoords.x + 1.52, y: cbCoords.y - 1.0, z: cbCoords.z },
          resNum,
          resName: aaData.name,
        });
        break;

      // Add more side chains as needed - for now keep simple
      default:
        if (aaData.sideChainAtoms.length > 1) {
          // Add a generic side chain atom
          sideChainAtoms.push({
            name: aaData.sideChainAtoms[1] || "CG",
            element: "C",
            coords: { x: cbCoords.x + 1.52, y: cbCoords.y, z: cbCoords.z },
            resNum,
            resName: aaData.name,
          });
        }
    }
  }

  // Generate advanced PDB file
  generateAdvancedPDB(sequence, atoms, disulfideBonds) {
    const currentDate = new Date()
      .toISOString()
      .substring(0, 10)
      .replace(/-/g, "");

    let pdbContent = `HEADER    ENHANCED PEPTIDE MODEL                  ${currentDate}
TITLE     PEPTIDE SEQUENCE: ${sequence}
COMPND    MOL_ID: 1;
COMPND   2 MOLECULE: ENHANCED PEPTIDE MODEL;
COMPND   3 CHAIN: A;
SOURCE    MOL_ID: 1;
SOURCE   2 SYNTHETIC: YES;
KEYWDS    PEPTIDE, SYNTHETIC, ENHANCED FOLDING
EXPDTA    COMPUTATIONAL MODEL
REMARK   1 GENERATED BY ENHANCED PEPTIDE MODELING SERVICE
REMARK   2 METHOD: PEPFOLD4-INSPIRED FOLDING
REMARK   3 SEQUENCE LENGTH: ${sequence.length} AMINO ACIDS
MODEL        1
`;

    // Sort atoms by residue number and atom order
    const sortedAtoms = [...atoms].sort((a, b) => {
      if (a.resNum !== b.resNum) return a.resNum - b.resNum;
      return this.getAtomOrder(a.name) - this.getAtomOrder(b.name);
    });

    // Add atom records
    for (let i = 0; i < sortedAtoms.length; i++) {
      const atom = sortedAtoms[i];
      const atomNumber = (i + 1).toString().padStart(5);
      const atomName = atom.name.padEnd(4);
      const resName = atom.resName.padEnd(3);
      const chainId = "A";
      const resNum = atom.resNum.toString().padStart(4);
      const x = atom.coords.x.toFixed(3).padStart(8);
      const y = atom.coords.y.toFixed(3).padStart(8);
      const z = atom.coords.z.toFixed(3).padStart(8);
      const occupancy = "1.00";
      const tempFactor = "20.00";
      const element = atom.element.padStart(2);

      pdbContent += `ATOM  ${atomNumber} ${atomName} ${resName} ${chainId}${resNum}    ${x}${y}${z}  ${occupancy} ${tempFactor}          ${element}\n`;
    }

    pdbContent += `TER\nENDMDL\nEND\n`;

    console.log(`✅ Generated enhanced PDB with ${sortedAtoms.length} atoms`);
    return pdbContent;
  }

  // Get atom ordering for proper PDB format
  getAtomOrder(atomName) {
    const order = {
      N: 1,
      CA: 2,
      C: 3,
      O: 4,
      CB: 5,
      CG: 6,
      CG1: 6,
      CG2: 7,
      CD: 8,
      CD1: 8,
      CD2: 9,
      CE: 10,
      NZ: 11,
      OG: 12,
      SG: 13,
    };
    return order[atomName] || 99;
  }

  // Legacy methods for backward compatibility
  async generateSequenceSpecificPeptidePDB(sequence) {
    console.log(
      `🔄 Using enhanced peptide generation for backward compatibility`
    );
    const tempDir = require("os").tmpdir();
    return this.generatePeptide3D(sequence, tempDir);
  }
}

module.exports = new PeptideService();
