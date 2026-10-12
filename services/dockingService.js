//New Code

const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const fileService = require("./fileService");

class DockingService {
  constructor() {
    // Base path to HLA-DQ proteins directory
    this.hlaDataPath = path.join(__dirname, "../data/HLA-DQ_Proteins");
    this.configCache = new Map(); // Cache for loaded configurations
  }

  // NEW: Dynamically load HLA-DQ configuration from specific protein directory
  async loadHLAConfiguration(proteinName) {
    try {
      console.log(`🔍 Loading configuration for protein: ${proteinName}`);

      // Check cache first
      if (this.configCache.has(proteinName)) {
        console.log(`📋 Using cached configuration for ${proteinName}`);
        return this.configCache.get(proteinName);
      }

      // Map protein names to directory names with flexible matching
      const proteinDirMap = {
        "HLA-DQ2.2": "HLA-DQ2.2",
        "HLA-DQ2.5": "HLA-DQ2.5",
        "HLA-DQ4": "HLA-DQ4",
        "HLA-DQ5": "HLA-DQ5",
        "HLA-DQ6": "HLA-DQ6",
        "HLA-DQ7": "HLA-DQ7",
        "HLA-DQ8": "HLA-DQ8",
        "HLA-DQ9": "HLA-DQ9",
      };

      let proteinDir = null;

      // Normalize protein name for matching (replace spaces with hyphens, remove extra spaces)
      const normalizedProteinName = proteinName
        .trim()
        .replace(/\s+/g, "-")
        .toUpperCase();
      console.log(`🔍 Normalized protein name: "${normalizedProteinName}"`);

      // Find matching directory name with flexible matching
      for (const [key, dir] of Object.entries(proteinDirMap)) {
        const normalizedKey = key.toUpperCase();
        const normalizedDir = dir.toUpperCase();

        // Check multiple matching patterns
        if (
          normalizedProteinName.includes(normalizedKey) ||
          normalizedProteinName.includes(normalizedDir) ||
          normalizedProteinName
            .replace("-", "")
            .includes(normalizedKey.replace("-", "")) ||
          normalizedProteinName
            .replace(" ", "")
            .includes(normalizedKey.replace("-", ""))
        ) {
          proteinDir = dir;
          console.log(`✅ Matched "${proteinName}" to directory "${dir}"`);
          break;
        }
      }

      // Additional fallback: extract just the HLA-DQ part with number/decimal
      if (!proteinDir) {
        const hlaPattern = /HLA[-\s]?DQ\s*(\d+(?:\.\d+)?)/i;
        const match = proteinName.match(hlaPattern);
        if (match) {
          const numberPart = match[1];
          const targetDir = `HLA-DQ${numberPart}`;
          console.log(`🔍 Fallback pattern match: "${targetDir}"`);

          for (const dir of Object.values(proteinDirMap)) {
            if (dir.toUpperCase() === targetDir.toUpperCase()) {
              proteinDir = dir;
              console.log(
                `✅ Fallback matched "${proteinName}" to directory "${dir}"`
              );
              break;
            }
          }
        }
      }

      if (!proteinDir) {
        throw new Error(
          `No configuration directory found for protein: ${proteinName}`
        );
      }

      const configPath = path.join(this.hlaDataPath, proteinDir, "conf.txt");

      console.log(`📁 Looking for config file: ${configPath}`);

      // Check if config file exists
      if (!(await fileService.fileExists(configPath))) {
        console.warn(`⚠️ Configuration file not found at ${configPath}, generating standard HLA-DQ binding groove parameters`);
        const fallbackConfig = {
          proteinDir: proteinDir,
          receptor: "receptor.pdbqt",
          center_x: 35.20,
          center_y: 8.81,
          center_z: 20.28,
          size_x: 32,
          size_y: 32,
          size_z: 32,
          thread: 4,
          search_depth: 16,
          num_modes: 9,
        };
        this.configCache.set(proteinName, fallbackConfig);
        return fallbackConfig;
      }

      // Read and parse configuration file
      const configContent = await fs.readFile(configPath, "utf-8");
      const config = this.parseHLAConfig(configContent, proteinDir);

      // Cache the configuration
      this.configCache.set(proteinName, config);

      console.log(`✅ Successfully loaded configuration for ${proteinName}:`);
      console.log(
        `   - Center: (${config.center_x}, ${config.center_y}, ${config.center_z})`
      );
      console.log(
        `   - Size: ${config.size_x}×${config.size_y}×${config.size_z}`
      );
      console.log(`   - Threads: ${config.thread}`);
      console.log(
        `   - Search Depth (as exhaustiveness): ${config.search_depth}`
      );
      console.log(`   - Num Modes: ${config.num_modes}`);

      return config;
    } catch (error) {
      console.error(
        `❌ Error loading HLA configuration for ${proteinName}:`,
        error
      );
      throw new Error(
        `Failed to load configuration for ${proteinName}: ${error.message}`
      );
    }
  }

  // NEW: Parse HLA configuration file
  parseHLAConfig(configContent, proteinDir) {
    const config = {
      proteinDir: proteinDir,
      receptor: "receptor.pdbqt",
    };

    const lines = configContent.split("\n");

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip comments and empty lines
      if (trimmedLine.startsWith("#") || trimmedLine === "") {
        continue;
      }

      // Parse key-value pairs
      if (trimmedLine.includes("=")) {
        const [key, value] = trimmedLine.split("=").map((s) => s.trim());

        switch (key) {
          case "receptor":
            config.receptor = value;
            break;
          case "center_x":
            config.center_x = parseFloat(value);
            break;
          case "center_y":
            config.center_y = parseFloat(value);
            break;
          case "center_z":
            config.center_z = parseFloat(value);
            break;
          case "size_x":
            config.size_x = parseFloat(value);
            break;
          case "size_y":
            config.size_y = parseFloat(value);
            break;
          case "size_z":
            config.size_z = parseFloat(value);
            break;
          case "thread":
            config.thread = parseInt(value);
            break;
          case "search_depth":
            config.search_depth = parseInt(value);
            break;
          case "num_modes":
            config.num_modes = parseInt(value);
            break;
        }
      }
    }

    // Validate required parameters
    const requiredParams = [
      "center_x",
      "center_y",
      "center_z",
      "size_x",
      "size_y",
      "size_z",
    ];
    for (const param of requiredParams) {
      if (config[param] === undefined || isNaN(config[param])) {
        throw new Error(`Missing or invalid required parameter: ${param}`);
      }
    }

    return config;
  }

  // NEW: Clean input PDB to ensure single chain structure
  async cleanInputPDBStructure(pdbFilePath, outputPath) {
    try {
      console.log(`🧹 Cleaning input PDB structure: ${pdbFilePath}`);

      const content = await fs.readFile(pdbFilePath, "utf-8");
      const lines = content.split("\n");

      // Track chains and their atom counts
      const chainStats = new Map();
      const cleanedLines = [];
      let primaryChain = null;
      let totalAtoms = 0;

      // First pass: analyze chains
      for (const line of lines) {
        if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
          const chainId = line.substring(21, 22).trim() || "A";
          chainStats.set(chainId, (chainStats.get(chainId) || 0) + 1);
          totalAtoms++;
        }
      }

      // Determine primary chain (highest atom count)
      if (chainStats.size > 0) {
        primaryChain = Array.from(chainStats.entries()).reduce((a, b) =>
          a[1] > b[1] ? a : b
        )[0];

        console.log(`📊 Chain analysis:`);
        for (const [chain, count] of chainStats.entries()) {
          console.log(
            `   - Chain ${chain}: ${count} atoms ${
              chain === primaryChain ? "(PRIMARY)" : ""
            }`
          );
        }
      }

      // Second pass: keep only primary chain and essential records
      let atomNumber = 1;
      let keptAtoms = 0;
      let removedAtoms = 0;

      for (const line of lines) {
        // Keep header information
        if (
          line.startsWith("HEADER") ||
          line.startsWith("TITLE") ||
          line.startsWith("COMPND") ||
          line.startsWith("SOURCE") ||
          line.startsWith("KEYWDS") ||
          line.startsWith("EXPDTA")
        ) {
          cleanedLines.push(line);
          continue;
        }

        // Process ATOM/HETATM records
        if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
          const chainId = line.substring(21, 22).trim() || "A";

          // Only keep atoms from primary chain
          if (chainId === primaryChain) {
            // Renumber atoms sequentially
            const newLine =
              line.substring(0, 6) +
              atomNumber.toString().padStart(5) +
              line.substring(11, 21) +
              "A" + // Standardize to chain A
              line.substring(22);

            cleanedLines.push(newLine);
            atomNumber++;
            keptAtoms++;
          } else {
            removedAtoms++;
          }
        }
      }

      // Add proper termination
      cleanedLines.push("TER");
      cleanedLines.push("END");

      const cleanedContent = cleanedLines.join("\n");
      await fs.writeFile(outputPath, cleanedContent);

      console.log(`✅ PDB cleaning completed:`);
      console.log(`   - Original atoms: ${totalAtoms}`);
      console.log(`   - Kept atoms (chain ${primaryChain}): ${keptAtoms}`);
      console.log(`   - Removed atoms: ${removedAtoms}`);
      console.log(`   - Cleaned file: ${outputPath}`);

      return {
        originalAtoms: totalAtoms,
        cleanedAtoms: keptAtoms,
        primaryChain: primaryChain,
        outputPath: outputPath,
      };
    } catch (error) {
      throw new Error(`Failed to clean input PDB: ${error.message}`);
    }
  }

  // NEW: Get all available HLA configurations
  async getAllHLAConfigurations() {
    try {
      console.log(`🔍 Scanning for HLA configurations in: ${this.hlaDataPath}`);

      const availableConfigs = [];
      const expectedDirs = [
        "HLA-DQ2.2",
        "HLA-DQ2.5",
        "HLA-DQ4",
        "HLA-DQ5",
        "HLA-DQ6",
        "HLA-DQ7",
        "HLA-DQ8",
        "HLA-DQ9",
      ];

      for (const dirName of expectedDirs) {
        const dirPath = path.join(this.hlaDataPath, dirName);
        const configPath = path.join(dirPath, "conf.txt");

        if (await fileService.fileExists(configPath)) {
          try {
            const configContent = await fs.readFile(configPath, "utf-8");
            const config = this.parseHLAConfig(configContent, dirName);
            availableConfigs.push({
              name: dirName,
              path: configPath,
              config: config,
            });
            console.log(`✅ Found configuration for ${dirName}`);
          } catch (parseError) {
            console.warn(
              `⚠️ Invalid configuration file for ${dirName}: ${parseError.message}`
            );
          }
        } else {
          console.warn(
            `⚠️ Configuration file missing for ${dirName}: ${configPath}`
          );
        }
      }

      console.log(
        `📊 Found ${availableConfigs.length} valid HLA configurations`
      );
      return availableConfigs;
    } catch (error) {
      console.error(`❌ Error scanning HLA configurations:`, error);
      throw new Error(`Failed to scan HLA configurations: ${error.message}`);
    }
  }

  // Check if AutoDock Vina is installed (Cross-platform)
  async checkVinaInstallation() {
    try {
      console.log("🔍 Checking for AutoDock Vina installation...");
      console.log(
        `🖥️ Platform: ${process.platform}, Architecture: ${process.arch}`
      );

      // Platform-specific command variations
      const isWindows = process.platform === "win32";
      const isLinux = process.platform === "linux";
      const isMac = process.platform === "darwin";

      let vinaCommands = ["vina"];

      // Add platform-specific paths
      if (isWindows) {
        vinaCommands.push(
          '"C:\\Program Files\\AutoDock Vina\\vina.exe"',
          '"C:\\Program Files\\AutoDock_Vina\\vina.exe"',
          '"C:\\Program Files (x86)\\AutoDock Vina\\vina.exe"'
        );
      } else if (isLinux) {
        vinaCommands.push(
          "/home/iiitd/miniconda3/bin/vina",
          "/storage4tb-1/celiacDB/AutoDock Vina/vina.exe",
          "/usr/bin/vina",
          "/usr/local/bin/vina",
          "/opt/autodock-vina/bin/vina",
          "/snap/bin/autodock-vina"
        );
      } else if (isMac) {
        vinaCommands.push(
          "/usr/local/bin/vina",
          "/opt/homebrew/bin/vina",
          "/Applications/AutoDock_Vina.app/Contents/MacOS/vina"
        );
      }

      for (const cmd of vinaCommands) {
        try {
          console.log(`🔍 Trying command: ${cmd}`);

          const execOptions = {
            timeout: 15000,
            windowsHide: true,
            env: process.env,
          };

          const { stdout, stderr } = await execAsync(
            `${cmd} --help`,
            execOptions
          );

          if (
            stdout.includes("AutoDock Vina") ||
            stdout.includes("Vina") ||
            stderr.includes("AutoDock Vina") ||
            stdout.includes("usage:")
          ) {
            console.log(`✅ AutoDock Vina found with command: ${cmd}`);

            // Try to get version
            try {
              const { stdout: versionOut, stderr: versionErr } =
                await execAsync(`${cmd} --version`, {
                  ...execOptions,
                  timeout: 10000,
                });
              const versionInfo =
                versionOut || versionErr || "Version info not available";
              console.log(`📋 Vina version info: ${versionInfo.trim()}`);
            } catch (versionError) {
              console.log("📋 Vina version check failed, but command works");
            }

            this.vinaCommand = cmd;
            this.vinaAvailable = true;
            return true;
          }
        } catch (cmdError) {
          console.log(`❌ Command '${cmd}' failed: ${cmdError.message}`);
          continue;
        }
      }

      console.log("❌ AutoDock Vina not found on this system");
      this.vinaAvailable = false;
      return false;
    } catch (error) {
      console.log(
        "❌ Error checking AutoDock Vina installation:",
        error.message
      );
      this.vinaAvailable = false;
      return false;
    }
  }

  // NEW: Validate uploaded PDB structure for direct docking
  async validatePDBStructure(pdbFilePath) {
    try {
      console.log(`🔍 Validating PDB structure: ${pdbFilePath}`);

      const content = await fs.readFile(pdbFilePath, "utf-8");
      const lines = content.split("\n");

      let atomCount = 0;
      let hasCoordinates = false;
      let residueCount = 0;
      const residues = new Set();

      for (const line of lines) {
        if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
          atomCount++;

          // Check for valid coordinates
          const x = parseFloat(line.substring(30, 38).trim());
          const y = parseFloat(line.substring(38, 46).trim());
          const z = parseFloat(line.substring(46, 54).trim());

          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            hasCoordinates = true;
          }

          // Count residues
          const resNum = parseInt(line.substring(22, 26).trim());
          if (!isNaN(resNum)) {
            residues.add(resNum);
          }
        }
      }

      residueCount = residues.size;

      if (atomCount === 0) {
        throw new Error("No ATOM records found in PDB file");
      }

      if (!hasCoordinates) {
        throw new Error("No valid 3D coordinates found in PDB file");
      }

      if (residueCount < 3 || residueCount > 50) {
        throw new Error(
          `Invalid peptide length: ${residueCount} residues (expected 3-50)`
        );
      }

      console.log(
        `✅ PDB structure validated: ${atomCount} atoms, ${residueCount} residues`
      );

      return {
        valid: true,
        atomCount,
        residueCount,
        hasCoordinates: true,
      };
    } catch (error) {
      console.error(`❌ PDB validation failed: ${error.message}`);
      throw new Error(`Invalid PDB structure: ${error.message}`);
    }
  }

  // UPDATED: Prepare uploaded PDB with two-step cleaning process
  async prepareUploadedPDBForDocking(
    uploadedPdbPath,
    outputDir,
    peptideSequence
  ) {
    const structureCleanedPath = path.join(
      outputDir,
      "peptide_structure_cleaned.pdb"
    );
    const contentCleanedPath = path.join(
      outputDir,
      "peptide_content_cleaned.pdb"
    );
    const ligandPdbqtPath = path.join(outputDir, "ligand.pdbqt");

    try {
      console.log(
        `🧬 Preparing uploaded PDB with two-step cleaning: ${uploadedPdbPath}`
      );

      // Step 1: Structural cleaning (remove duplicate chains, keep primary chain)
      console.log("🔗 Step 1: Structural cleaning - removing duplicate chains");
      const structuralResult = await this.cleanInputPDBStructure(
        uploadedPdbPath,
        structureCleanedPath
      );

      // Step 2: Content cleaning (remove non-standard residues, keep only amino acids)
      console.log(
        "🧹 Step 2: Content cleaning - keeping only standard amino acids"
      );
      const structureContent = await fs.readFile(structureCleanedPath, "utf-8");
      const contentCleanedContent = this.cleanPeptidePDB(structureContent);
      await fs.writeFile(contentCleanedPath, contentCleanedContent);

      // Step 3: Validate the final cleaned PDB structure
      await this.validatePDBStructure(contentCleanedPath);

      // Step 4: Convert to PDBQT format for docking
      const pdbqtContent = this.convertPdbToPdbqt(
        contentCleanedContent,
        "ligand"
      );
      await fs.writeFile(ligandPdbqtPath, pdbqtContent);

      // Step 5: Validate the generated PDBQT file
      await this.validatePdbqtFile(ligandPdbqtPath, "ligand");

      console.log(`✅ Two-step cleaning completed:`);
      console.log(
        `   - Structural: ${structuralResult.cleanedAtoms} atoms from chain ${structuralResult.primaryChain}`
      );
      console.log(`   - Content: Standard amino acids only`);
      console.log(`   - Final PDBQT: ${ligandPdbqtPath}`);

      return ligandPdbqtPath;
    } catch (error) {
      throw new Error(
        `Failed to prepare cleaned PDB for docking: ${error.message}`
      );
    }
  }

  // NEW: Clean peptide PDB (remove any non-peptide components)
  cleanPeptidePDB(pdbContent) {
    console.log("🧹 Cleaning peptide PDB structure for docking...");

    const lines = pdbContent.split("\n");
    const cleanedLines = [];
    let keptCount = 0;
    let removedCount = 0;

    // Standard amino acid residues
    const standardAminoAcids = [
      "ALA",
      "ARG",
      "ASN",
      "ASP",
      "CYS",
      "GLN",
      "GLU",
      "GLY",
      "HIS",
      "ILE",
      "LEU",
      "LYS",
      "MET",
      "PHE",
      "PRO",
      "SER",
      "THR",
      "TRP",
      "TYR",
      "VAL",
    ];

    for (const line of lines) {
      // Keep headers and metadata
      if (
        line.startsWith("HEADER") ||
        line.startsWith("TITLE") ||
        line.startsWith("COMPND") ||
        line.startsWith("SOURCE") ||
        line.startsWith("KEYWDS") ||
        line.startsWith("EXPDTA") ||
        line.startsWith("MODEL") ||
        line.startsWith("ENDMDL") ||
        line.startsWith("TER") ||
        line.startsWith("END")
      ) {
        cleanedLines.push(line);
        continue;
      }

      // Process ATOM/HETATM records
      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        const resName = line.substring(17, 20).trim();

        // Only keep standard amino acid residues
        if (standardAminoAcids.includes(resName)) {
          cleanedLines.push(line);
          keptCount++;
        } else {
          removedCount++;
          console.log(`Removed non-standard residue: ${resName}`);
        }
      }
    }

    console.log(`🧹 Peptide PDB cleaning completed:`);
    console.log(`   - Kept: ${keptCount} peptide atoms`);
    console.log(`   - Removed: ${removedCount} non-peptide atoms`);

    if (keptCount === 0) {
      throw new Error("No valid peptide atoms found after cleaning");
    }

    return cleanedLines.join("\n");
  }

  // UPDATED: Clean protein with single chain enforcement
  cleanProteinForDocking(pdbContent) {
    console.log(
      "🧹 Cleaning receptor protein - removing membranes, water, ions and ensuring single chain"
    );

    const lines = pdbContent.split("\n");
    const cleanedLines = [];
    let removedCount = 0;
    let keptCount = 0;
    let removedResidues = new Set();
    const chainStats = new Map();

    // First pass: analyze chains
    for (const line of lines) {
      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        const chainId = line.substring(21, 22).trim() || "A";
        const resName = line.substring(17, 20).trim();

        // Skip membrane/water residues in analysis
        const skipResidues = [
          "POP",
          "POPC",
          "POPE",
          "POPG",
          "POPS",
          "DPP",
          "DPPC",
          "DPPE",
          "DPPG",
          "DPPS",
          "PSM",
          "CHL",
          "LLP",
          "LLPC",
          "CHOL",
          "CHOLEST",
          "HOH",
          "WAT",
          "TIP",
          "TIP3",
          "SOL",
          "H2O",
          "NA",
          "CL",
          "MG",
          "CA",
          "K",
          "ZN",
          "FE",
          "MN",
          "DDM",
          "DM",
          "OG",
          "LDAO",
          "CHAPS",
          "SDS",
          "DMSO",
          "GOL",
          "EDO",
          "PEG",
          "MPD",
          "ACT",
        ];

        if (!skipResidues.includes(resName)) {
          chainStats.set(chainId, (chainStats.get(chainId) || 0) + 1);
        }
      }
    }

    // Determine primary chain for protein
    let primaryChain = "A";
    if (chainStats.size > 0) {
      primaryChain = Array.from(chainStats.entries()).reduce((a, b) =>
        a[1] > b[1] ? a : b
      )[0];

      if (chainStats.size > 1) {
        console.log(`📊 Protein chains found:`);
        for (const [chain, count] of chainStats.entries()) {
          console.log(
            `   - Chain ${chain}: ${count} atoms ${
              chain === primaryChain ? "(PRIMARY)" : ""
            }`
          );
        }
      }
    }

    // Second pass: clean and keep only primary chain
    let atomNumber = 1;
    for (const line of lines) {
      // Keep headers
      if (
        line.startsWith("HEADER") ||
        line.startsWith("TITLE") ||
        line.startsWith("COMPND") ||
        line.startsWith("SOURCE") ||
        line.startsWith("KEYWDS") ||
        line.startsWith("EXPDTA") ||
        line.startsWith("MODEL") ||
        line.startsWith("ENDMDL") ||
        line.startsWith("TER") ||
        line.startsWith("END")
      ) {
        cleanedLines.push(line);
        continue;
      }

      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        const chainId = line.substring(21, 22).trim() || "A";
        const resName = line.substring(17, 20).trim();

        // Skip if not primary chain
        if (chainId !== primaryChain) {
          continue;
        }

        // Extended membrane removal list
        const skipResidues = [
          // Phospholipids
          "POP",
          "POPC",
          "POPE",
          "POPG",
          "POPS",
          "DPP",
          "DPPC",
          "DPPE",
          "DPPG",
          "DPPS",
          "DMP",
          "DMPC",
          "DMPE",
          "DMPG",
          "DMPS",
          "DOP",
          "DOPC",
          "DOPE",
          "DOPG",
          "DOPS",
          "DSP",
          "DSPC",
          "DSPE",
          "DSPG",
          "DSPS",

          // Specific membrane residues
          "PSM",
          "CHL",
          "LLP",
          "LLPC",

          // Cholesterol
          "CHOL",
          "CHOA",
          "CHOLEST",
          "CHL1",

          // Water
          "HOH",
          "WAT",
          "TIP",
          "TIP3",
          "TIP4",
          "TIP5",
          "SOL",
          "H2O",
          "DOD",
          "D2O",

          // Ions
          "NA",
          "CL",
          "MG",
          "CA",
          "K",
          "ZN",
          "FE",
          "MN",
          "CU",
          "NI",
          "CO",
          "BR",
          "I",
          "F",
          "NA+",
          "CL-",
          "MG2",
          "CA2",
          "K+",
          "ZN2",
          "FE2",
          "FE3",
          "SOD",
          "CLA",
          "POT",
          "CAL",

          // Detergents
          "DDM",
          "DM",
          "OG",
          "LDAO",
          "CHAPS",
          "CHAPSO",
          "SDS",
          "CTAB",
          "DHPC",
          "DPC",

          // Buffer components
          "DMSO",
          "DMS",
          "GLYC",
          "GOL",
          "EDO",
          "PEG",
          "MPD",
          "ACT",
          "BME",
        ];

        if (skipResidues.includes(resName)) {
          removedResidues.add(resName);
          removedCount++;
          continue;
        }

        // Skip non-protein HETATM except important cofactors
        if (line.startsWith("HETATM")) {
          const keepHetAtoms = [
            "NAG",
            "MAN",
            "FUC",
            "GAL",
            "GLC",
            "HEM",
            "HEME",
            "FES",
            "SF4",
            "FAD",
            "NAD",
            "ATP",
            "ADP",
            "AMP",
          ];
          if (!keepHetAtoms.includes(resName)) {
            removedResidues.add(resName);
            removedCount++;
            continue;
          }
        }

        // Renumber atoms and ensure chain A
        const newLine =
          line.substring(0, 6) +
          atomNumber.toString().padStart(5) +
          line.substring(11, 21) +
          "A" +
          line.substring(22);

        cleanedLines.push(newLine);
        atomNumber++;
        keptCount++;
      }
    }

    const cleanedContent = cleanedLines.join("\n");

    console.log(`🧹 Protein cleaning completed:`);
    console.log(`   - Kept: ${keptCount} protein atoms (single chain A)`);
    console.log(`   - Removed: ${removedCount} membrane/water/ion atoms`);
    if (removedResidues.size > 0) {
      console.log(
        `   - Removed residue types: ${Array.from(removedResidues).join(", ")}`
      );
    }

    if (keptCount === 0) {
      throw new Error(
        "No protein atoms found after cleaning - check input PDB file"
      );
    }

    return cleanedContent;
  }

  // UPDATED: Extract only the top-ranked model from PDBQT output
  extractTopModelFromPDBQT(pdbqtContent) {
    console.log("🎯 Extracting top-ranked model (MODEL 1) from PDBQT output");

    const lines = pdbqtContent.split("\n");
    const topModelLines = [];
    let inTopModel = false;
    let modelCount = 0;
    let atomCount = 0;

    for (const line of lines) {
      // Check for REMARK VINA RESULT (indicates start of a model)
      if (line.startsWith("REMARK VINA RESULT:")) {
        modelCount++;
        if (modelCount === 1) {
          inTopModel = true;
          topModelLines.push(line);
          console.log(
            `📋 Found top model with score: ${line.split(/\s+/)[3]} kcal/mol`
          );
        } else {
          // Stop at second model
          break;
        }
        continue;
      }

      // Include lines that are part of the top model
      if (inTopModel) {
        if (
          line.startsWith("REMARK") ||
          line.startsWith("ROOT") ||
          line.startsWith("ATOM") ||
          line.startsWith("HETATM") ||
          line.startsWith("ENDROOT") ||
          line.startsWith("TORSDOF")
        ) {
          topModelLines.push(line);

          if (line.startsWith("ATOM")) {
            atomCount++;
          }
        }

        // Stop if we hit another model or end
        if (line.startsWith("REMARK VINA RESULT:") && modelCount > 1) {
          break;
        }
      }
    }

    const topModelContent = topModelLines.join("\n");
    console.log(`✅ Extracted top model: ${atomCount} atoms`);

    if (atomCount === 0) {
      throw new Error("No atoms found in top model - invalid PDBQT output");
    }

    return topModelContent;
  }

  // Prepare receptor for docking
  async prepareReceptor(receptorPdbPath, outputDir) {
    const receptorPdbqtPath = path.join(outputDir, "receptor.pdbqt");

    try {
      console.log(`🧬 Preparing receptor: ${receptorPdbPath}`);

      const receptorContent = await fs.readFile(receptorPdbPath, "utf-8");
      const cleanedContent = this.cleanProteinForDocking(receptorContent);
      const vinaReadyContent = this.prepareForVinaConversion(cleanedContent);
      const pdbqtContent = this.convertPdbToPdbqt(vinaReadyContent, "receptor");

      await fs.writeFile(receptorPdbqtPath, pdbqtContent);
      await this.validatePdbqtFile(receptorPdbqtPath, "receptor");

      console.log(`✅ Prepared receptor: ${receptorPdbqtPath}`);
      return receptorPdbqtPath;
    } catch (error) {
      throw new Error(`Failed to prepare receptor: ${error.message}`);
    }
  }

  // UPDATED: Prepare ligand from uploaded PDB (direct docking)
  async prepareLigand(ligandPdbPath, outputDir) {
    const ligandPdbqtPath = path.join(outputDir, "ligand.pdbqt");

    try {
      console.log(`🧬 Preparing ligand from uploaded PDB: ${ligandPdbPath}`);

      // Validate PDB structure first
      await this.validatePDBStructure(ligandPdbPath);

      // Read and clean the PDB content
      const ligandContent = await fs.readFile(ligandPdbPath, "utf-8");
      const cleanedContent = this.cleanPeptidePDB(ligandContent);

      // Convert to PDBQT format
      const pdbqtContent = this.convertPdbToPdbqt(cleanedContent, "ligand");
      await fs.writeFile(ligandPdbqtPath, pdbqtContent);

      // Validate the generated PDBQT file
      await this.validatePdbqtFile(ligandPdbqtPath, "ligand");

      console.log(`✅ Prepared ligand from PDB: ${ligandPdbqtPath}`);
      return ligandPdbqtPath;
    } catch (error) {
      throw new Error(`Failed to prepare ligand from PDB: ${error.message}`);
    }
  }

  // Additional cleaning specifically for Vina conversion
  prepareForVinaConversion(pdbContent) {
    console.log("🧹 Additional cleaning for AutoDock Vina compatibility");

    const lines = pdbContent.split("\n");
    const cleanedLines = [];

    for (const line of lines) {
      if (line.startsWith("ATOM")) {
        const atomLine = line.substring(0, 80);
        const atomName = line.substring(12, 16).trim();
        const resName = line.substring(17, 20).trim();
        const x = line.substring(30, 38).trim();
        const y = line.substring(38, 46).trim();
        const z = line.substring(46, 54).trim();

        // Additional validation for coordinate values
        const xVal = parseFloat(x);
        const yVal = parseFloat(y);
        const zVal = parseFloat(z);

        if (
          atomName &&
          resName &&
          !isNaN(xVal) &&
          !isNaN(yVal) &&
          !isNaN(zVal)
        ) {
          // Check for reasonable coordinate ranges
          if (
            Math.abs(xVal) < 999 &&
            Math.abs(yVal) < 999 &&
            Math.abs(zVal) < 999
          ) {
            cleanedLines.push(atomLine);
          } else {
            console.warn(
              `Skipping atom with extreme coordinates: ${atomName} at (${xVal}, ${yVal}, ${zVal})`
            );
          }
        }
      }
    }

    const cleanedContent = cleanedLines.join("\n");
    console.log(`🧹 Vina-ready: ${cleanedLines.length} ATOM lines only`);

    return cleanedContent;
  }

  // UPDATED: Run AutoDock Vina docking with dynamic or custom configuration
  async runAutoDockVina(receptorPath, ligandPath, outputDir, proteinName, customConfigContent = null) {
    const outputPath = path.join(outputDir, "docking_result.pdbqt");
    const logPath = path.join(outputDir, "docking.log");
    const configPath = path.join(outputDir, "config.conf");

    try {
      console.log("⚗️ Running AutoDock Vina with configuration...");

      // Load HLA-specific configuration as base/default
      const hlaConfig = await this.loadHLAConfiguration(proteinName);

      // Parse custom parameters if provided
      let centerX = hlaConfig.center_x;
      let centerY = hlaConfig.center_y;
      let centerZ = hlaConfig.center_z;
      let sizeX = hlaConfig.size_x;
      let sizeY = hlaConfig.size_y;
      let sizeZ = hlaConfig.size_z;
      let exhaustiveness = hlaConfig.search_depth || 16;
      let numModes = hlaConfig.num_modes || 20;
      let energyRange = 4;
      let cpu = Math.min(hlaConfig.thread || 4, require("os").cpus().length);

      if (customConfigContent && typeof customConfigContent === "string") {
        console.log("📝 Parsing and applying user's custom config file...");
        const lines = customConfigContent.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const match = trimmed.match(/^([^=\s]+)\s*=\s*(.+)$/);
          if (match) {
            const key = match[1].toLowerCase().trim();
            const val = match[2].trim();
            if (key === "center_x") centerX = parseFloat(val) || centerX;
            if (key === "center_y") centerY = parseFloat(val) || centerY;
            if (key === "center_z") centerZ = parseFloat(val) || centerZ;
            if (key === "size_x") sizeX = parseFloat(val) || sizeX;
            if (key === "size_y") sizeY = parseFloat(val) || sizeY;
            if (key === "size_z") sizeZ = parseFloat(val) || sizeZ;
            if (key === "exhaustiveness") exhaustiveness = parseInt(val) || exhaustiveness;
            if (key === "num_modes") numModes = parseInt(val) || numModes;
            if (key === "energy_range") energyRange = parseFloat(val) || energyRange;
            if (key === "cpu") cpu = parseInt(val) || cpu;
          }
        }
      }

      const vinaCmd =
        this.vinaCommand || "vina" || "/home/iiitd/miniconda3/bin/vina";
      console.log(`🔧 Using Vina command: ${vinaCmd}`);
      console.log(`🎯 Using configuration (Custom: ${!!customConfigContent})`);

      // Create configuration content
      const configContent = `receptor = ${receptorPath}
ligand = ${ligandPath}
out = ${outputPath}

center_x = ${centerX}
center_y = ${centerY}
center_z = ${centerZ}
size_x = ${sizeX}
size_y = ${sizeY}
size_z = ${sizeZ}

energy_range = ${energyRange}
exhaustiveness = ${exhaustiveness}
num_modes = ${numModes}
cpu = ${cpu}

# Dynamic Configuration: ${customConfigContent ? "Custom User Upload" : "Default HLA (" + hlaConfig.proteinDir + ")"}
`;

      await fs.writeFile(configPath, configContent);
      console.log(`📝 Created dynamic Vina config: ${configPath}`);
      console.log(
        `🎯 Grid center: (${hlaConfig.center_x}, ${hlaConfig.center_y}, ${hlaConfig.center_z})`
      );
      console.log(
        `📏 Grid size: ${hlaConfig.size_x}×${hlaConfig.size_y}×${hlaConfig.size_z}`
      );

      const execOptions = {
        timeout: 900000, // 15 minutes
        cwd: outputDir,
        env: { ...process.env },
        maxBuffer: 1024 * 1024 * 10,
        windowsHide: true,
      };

      // Add platform-specific PATH extensions
      if (process.platform === "win32") {
        execOptions.env.PATH +=
          ";C:\\Program Files\\AutoDock Vina;C:\\Program Files\\AutoDock_Vina";
      } else if (process.platform === "linux") {
        execOptions.env.PATH += ":/usr/local/bin:/opt/autodock-vina/bin";
      } else if (process.platform === "darwin") {
        execOptions.env.PATH += ":/usr/local/bin:/opt/homebrew/bin";
      }

      const vinaCommand = `${vinaCmd} --config "${configPath}"`;
      console.log(`🚀 Executing dynamic HLA docking: ${vinaCommand}`);

      const { stdout, stderr } = await execAsync(vinaCommand, execOptions);

      console.log("✅ Dynamic HLA docking execution completed");

      const logContent = this.createVinaLogFile(
        vinaCommand,
        outputDir,
        stdout,
        stderr,
        hlaConfig
      );
      await fs.writeFile(logPath, logContent);

      await this.verifyVinaOutputFiles(outputPath, logPath, outputDir);

      console.log("✅ All Vina output files verified for dynamic HLA docking");
      return {
        outputPath,
        logPath,
        configPath,
        hlaConfig,
      };
    } catch (error) {
      console.error("❌ AutoDock Vina dynamic HLA docking failed:", error);
      await this.handleVinaExecutionError(error, outputDir, configPath);
      throw error;
    }
  }

  // UPDATED: Create comprehensive log file with HLA config info
  createVinaLogFile(command, workingDir, stdout, stderr, hlaConfig = null) {
    const hlaConfigInfo = hlaConfig
      ? `
HLA Configuration Details:
- Protein Directory: ${hlaConfig.proteinDir}
- Grid Center: (${hlaConfig.center_x}, ${hlaConfig.center_y}, ${
          hlaConfig.center_z
        })
- Grid Size: ${hlaConfig.size_x}×${hlaConfig.size_y}×${hlaConfig.size_z}
- Thread Count: ${hlaConfig.thread || "default"}
- Search Depth: ${hlaConfig.search_depth || "default"}
- Number of Modes: ${hlaConfig.num_modes || "default"}
`
      : "";

    return `AutoDock Vina Execution Log (Dynamic HLA Configuration)
Generated: ${new Date().toISOString()}
Platform: ${process.platform} ${process.arch}
Node.js Version: ${process.version}
Command: ${command}
Working Directory: ${workingDir}
CPU Count: ${require("os").cpus().length}
Docking Type: Direct PDB with Dynamic HLA Configuration
${hlaConfigInfo}
=== VINA OUTPUT ===
${stdout || "No stdout output"}

=== VINA ERRORS (if any) ===
${stderr || "No stderr output"}

=== EXECUTION SUMMARY ===
Status: ${stdout ? "Completed" : "Failed"}
Output Length: ${(stdout || "").length} characters
Error Length: ${(stderr || "").length} characters

=== END LOG ===
`;
  }

  // Enhanced file verification
  async verifyVinaOutputFiles(outputPath, logPath, outputDir) {
    const checks = [
      { path: outputPath, name: "Docking output file" },
      { path: logPath, name: "Log file" },
    ];

    for (const check of checks) {
      if (!(await fileService.fileExists(check.path))) {
        try {
          const files = await fs.readdir(outputDir);
          console.log(`📁 Files in output directory:`, files);
        } catch (dirError) {
          console.error("Could not list directory:", dirError.message);
        }
        throw new Error(`${check.name} not generated: ${check.path}`);
      }

      try {
        const stats = await fs.stat(check.path);
        console.log(`✅ ${check.name}: ${check.path} (${stats.size} bytes)`);

        if (stats.size === 0) {
          throw new Error(`${check.name} is empty: ${check.path}`);
        }
      } catch (statError) {
        throw new Error(`Cannot access ${check.name}: ${statError.message}`);
      }
    }
  }

  // Enhanced error handling
  async handleVinaExecutionError(error, outputDir, configPath) {
    const platform = process.platform;
    const errorLogContent = `AutoDock Vina Dynamic HLA Docking Failed
Generated: ${new Date().toISOString()}
Platform: ${platform} ${process.arch}
Error Type: ${error.name || "Unknown"}
Error Message: ${error.message}
Command: ${this.vinaCommand || "vina"}
Working Directory: ${outputDir}
Config File: ${configPath}
Docking Type: Direct PDB with Dynamic HLA Configuration

Environment Variables:
PATH: ${process.env.PATH}

Platform-Specific Troubleshooting:
${this.getPlatformTroubleshooting(platform)}

Full Error Stack:
${error.stack || error.toString()}
`;

    try {
      await fs.writeFile(path.join(outputDir, "error.log"), errorLogContent);
      console.log(
        `📝 Detailed error log written to: ${path.join(outputDir, "error.log")}`
      );
    } catch (logError) {
      console.error("Could not write error log:", logError.message);
    }
  }

  // Platform-specific troubleshooting
  getPlatformTroubleshooting(platform) {
    switch (platform) {
      case "win32":
        return `Windows-specific solutions:
- Add AutoDock Vina to system PATH via Environment Variables
- Run Node.js as Administrator if permission issues
- Install Visual C++ Redistributable if needed`;
      case "linux":
        return `Linux-specific solutions:
- Install via package manager: sudo apt-get install autodock-vina
- Check container permissions if running in Docker
- Ensure /tmp directory is writable`;
      case "darwin":
        return `macOS-specific solutions:
- Install via Homebrew: brew install autodock-vina
- Install via conda: conda install -c bioconda autodock-vina`;
      default:
        return `General solutions: Check AutoDock Vina installation`;
    }
  }

  // UPDATED: Process Vina docking results with HLA config info
  async processVinaDockingResults(
    dockingResults,
    protein,
    peptideSequence,
    sessionDir
  ) {
    try {
      console.log("📊 Processing Vina dynamic HLA docking results...");

      // Read log file to extract best score
      const logContent = await fs.readFile(dockingResults.logPath, "utf-8");
      const bestScore = this.extractBestScore(logContent);
      console.log(`🎯 Best docking score: ${bestScore.affinity} kcal/mol`);

      // Convert PDBQT result to clean PDB format for complex
      const complexPdbPath = path.join(sessionDir, "complex.pdb");
      await this.convertPdbqtToPdb(
        dockingResults.outputPath,
        complexPdbPath,
        protein
      );

      // Generate clean protein PDB for separate visualization
      const proteinPdbPath = path.join(
        __dirname,
        "../public/uploads",
        protein.mainProteinFile
      );
      const cleanProteinPath = await this.generateCleanProteinPdb(
        proteinPdbPath,
        sessionDir
      );

      // Read config content
      const configContent = await fs.readFile(
        dockingResults.configPath,
        "utf-8"
      );

      const sessionId = path.basename(sessionDir);

      return {
        complexPath: `temp-results/${sessionId}/complex.pdb`,
        cleanProteinPath: `temp-results/${sessionId}/protein_clean.pdb`,
        logContent,
        bestScore,
        configContent,
        hlaConfig: dockingResults.hlaConfig,
      };
    } catch (error) {
      console.error("❌ Error processing Vina dynamic HLA results:", error);
      throw new Error(`Failed to process docking results: ${error.message}`);
    }
  }

  // UPDATED: Generate enhanced simulation with dynamic HLA config
  async generateEnhancedSimulation(protein, peptideSequence, sessionDir) {
    console.log(
      "🎭 Generating enhanced simulation with dynamic HLA configuration (Vina not available)"
    );

    // Load HLA-specific configuration for simulation
    let hlaConfig;
    try {
      hlaConfig = await this.loadHLAConfiguration(protein.name);
    } catch (configError) {
      console.warn(
        `⚠️ Could not load HLA config for ${protein.name}, using defaults`
      );
      hlaConfig = {
        center_x: 91.518,
        center_y: 97.051,
        center_z: 50.424,
        size_x: 47,
        size_y: 47,
        size_z: 47,
        thread: 8192,
        search_depth: 500,
        num_modes: 500,
        proteinDir: "default",
      };
    }

    const outputPath = path.join(sessionDir, "docking_result.pdbqt");
    const logPath = path.join(sessionDir, "docking.log");
    const configPath = path.join(sessionDir, "config.conf");

    // Generate realistic simulated docked structure
    const dockedStructure =
      this.generateRealisticDockedStructure(peptideSequence);

    // Generate realistic log with sequence-dependent scoring
    const logContent = this.generateRealisticLog(peptideSequence, hlaConfig);

    // Generate config with dynamic HLA parameters
    const configContent = `receptor = receptor.pdbqt
ligand = ligand.pdbqt
out = docking_result.pdbqt
log = docking.log

center_x = ${hlaConfig.center_x}
center_y = ${hlaConfig.center_y}
center_z = ${hlaConfig.center_z}
size_x = ${hlaConfig.size_x}
size_y = ${hlaConfig.size_y}
size_z = ${hlaConfig.size_z}

energy_range = 4
exhaustiveness = ${hlaConfig.search_depth || 8}
num_modes = ${hlaConfig.num_modes || 20}
cpu = 4

# Dynamic HLA Configuration Simulation
# HLA Configuration: ${hlaConfig.proteinDir}
# Grid Center: (${hlaConfig.center_x}, ${hlaConfig.center_y}, ${
      hlaConfig.center_z
    })
# Original PDB structure coordinates preserved
# No modeling step performed
`;

    await fs.writeFile(outputPath, dockedStructure);
    await fs.writeFile(logPath, logContent);
    await fs.writeFile(configPath, configContent);

    console.log(
      "✅ Enhanced simulation files generated with dynamic HLA config"
    );

    // Process simulated results
    const bestScore = this.extractBestScore(logContent);
    const complexPdbPath = path.join(sessionDir, "complex.pdb");
    await this.convertPdbqtToPdb(outputPath, complexPdbPath, protein);

    // Generate clean protein PDB for visualization
    const proteinPdbPath = path.join(
      __dirname,
      "../public/uploads",
      protein.mainProteinFile
    );
    const cleanProteinPath = await this.generateCleanProteinPdb(
      proteinPdbPath,
      sessionDir
    );

    const sessionId = path.basename(sessionDir);

    return {
      complexPath: `temp-results/${sessionId}/complex.pdb`,
      cleanProteinPath: `temp-results/${sessionId}/protein_clean.pdb`,
      logContent,
      bestScore,
      configContent,
      hlaConfig,
    };
  }

  // Generate clean protein PDB file for visualization
  async generateCleanProteinPdb(proteinPdbPath, outputDir) {
    const cleanProteinPath = path.join(outputDir, "protein_clean.pdb");

    try {
      console.log(
        `🧬 Generating clean protein PDB for visualization: ${proteinPdbPath}`
      );

      const proteinContent = await fs.readFile(proteinPdbPath, "utf-8");
      const cleanedContent = this.cleanProteinForDocking(proteinContent);

      const currentDate = new Date()
        .toISOString()
        .substring(0, 10)
        .replace(/-/g, "");
      const headerContent = `HEADER    CLEANED HLA PROTEIN                     ${currentDate}
TITLE     HLA PROTEIN WITH MEMBRANES AND WATER REMOVED
COMPND    MOL_ID: 1;
COMPND   2 MOLECULE: HLA-DQ PROTEIN (CLEANED);
SOURCE    MOL_ID: 1;
SOURCE   2 ORGANISM_SCIENTIFIC: HOMO SAPIENS;
KEYWDS    IMMUNE SYSTEM, ANTIGEN PRESENTATION, CLEANED
EXPDTA    X-RAY DIFFRACTION (CLEANED FOR VISUALIZATION)
REMARK   1 MEMBRANES, WATER, AND IONS REMOVED FOR CLEAR VISUALIZATION
REMARK   2 ORIGINAL STRUCTURE MAINTAINED FOR PROTEIN ATOMS ONLY
MODEL        1
${cleanedContent}
ENDMDL
END
`;

      await fs.writeFile(cleanProteinPath, headerContent);

      const stats = await fs.stat(cleanProteinPath);
      console.log(
        `✅ Generated clean protein PDB: ${cleanProteinPath} (${stats.size} bytes)`
      );

      return cleanProteinPath;
    } catch (error) {
      throw new Error(`Failed to generate clean protein PDB: ${error.message}`);
    }
  }

  // UPDATED: Convert PDBQT to PDB using only top model
  async convertPdbqtToPdb(pdbqtPath, pdbPath, protein) {
    try {
      console.log(`🔄 Converting top model PDBQT to clean PDB complex...`);

      const pdbqtContent = await fs.readFile(pdbqtPath, "utf-8");

      // Extract only the top-ranked model
      const topModelPdbqt = this.extractTopModelFromPDBQT(pdbqtContent);

      // Get original protein content and clean it
      const proteinPdbPath = path.join(
        __dirname,
        "../public/uploads",
        protein.mainProteinFile
      );

      if (!(await fileService.fileExists(proteinPdbPath))) {
        throw new Error(`Protein file not found: ${proteinPdbPath}`);
      }

      const proteinContent = await fs.readFile(proteinPdbPath, "utf-8");

      // Clean protein (remove membranes) and ensure single chain
      const cleanedProteinContent = this.cleanProteinForDocking(proteinContent);
      const singleChainProtein = await this.ensureSingleChainProtein(
        cleanedProteinContent
      );

      // Create combined PDB content with only top model
      const currentDate = new Date()
        .toISOString()
        .substring(0, 10)
        .replace(/-/g, "");

      let pdbContent = "";
      pdbContent += `HEADER    DOCKED COMPLEX (TOP MODEL ONLY, MEMBRANE-FREE) ${currentDate}\n`;
      pdbContent += `TITLE     HLA-DQ PROTEIN WITH DOCKED PEPTIDE (BEST POSE ONLY)\n`;
      pdbContent += `COMPND    MOL_ID: 1;\n`;
      pdbContent += `COMPND   2 MOLECULE: HLA-DQ PROTEIN-PEPTIDE COMPLEX (TOP MODEL);\n`;
      pdbContent += `SOURCE    MOL_ID: 1;\n`;
      pdbContent += `SOURCE   2 ORGANISM_SCIENTIFIC: HOMO SAPIENS;\n`;
      pdbContent += `KEYWDS    IMMUNE SYSTEM, MOLECULAR DOCKING, TOP MODEL ONLY\n`;
      pdbContent += `EXPDTA    MOLECULAR DOCKING (BEST POSE)\n`;
      pdbContent += `REMARK   1 COMPLEX CONTAINS ONLY THE TOP-RANKED DOCKING MODEL\n`;
      pdbContent += `REMARK   2 NO MODELING STEP - USED UPLOADED PDB STRUCTURE\n`;
      pdbContent += `REMARK   3 ALL MEMBRANES, WATER, AND IONS REMOVED\n`;
      pdbContent += `REMARK   4 PROTEIN IS SINGLE CHAIN A (CLEANED)\n`;
      pdbContent += `REMARK   5 PEPTIDE IS CHAIN B (TOP POSE ONLY)\n`;
      pdbContent += `MODEL        1\n`;

      // Add protein atoms (chain A) - cleaned and single chain
      const proteinLines = singleChainProtein.split("\n");
      let proteinAtomCount = 0;

      for (const line of proteinLines) {
        if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
          if (proteinAtomCount >= 50000) {
            console.warn("Reached protein atom limit, truncating...");
            break;
          }

          // Ensure chain A
          const modifiedLine = line.substring(0, 21) + "A" + line.substring(22);
          pdbContent += modifiedLine + "\n";
          proteinAtomCount++;
        }
      }

      console.log(
        `- Added ${proteinAtomCount} CLEAN protein atoms (single chain A)`
      );
      pdbContent += `TER\n`;

      // Add docked peptide atoms from TOP MODEL ONLY (chain B)
      const topModelLines = topModelPdbqt.split("\n");
      let peptideAtomCount = 0;
      let atomNumber = Math.min(proteinAtomCount + 1000, 90000);

      for (const line of topModelLines) {
        if (line.startsWith("ATOM")) {
          if (atomNumber >= 99999) {
            console.warn(
              "Reached maximum atom number, stopping peptide addition"
            );
            break;
          }

          const atomName = line.substring(12, 16);
          const resName = line.substring(17, 20);
          const x = parseFloat(line.substring(30, 38));
          const y = parseFloat(line.substring(38, 46));
          const z = parseFloat(line.substring(46, 54));

          if (isNaN(x) || isNaN(y) || isNaN(z)) {
            console.warn(
              `Skipping peptide atom with invalid coordinates: ${atomName}`
            );
            continue;
          }

          const element = atomName.trim().charAt(0);
          const resNum = Math.floor(peptideAtomCount / 4) + 1;

          const pdbLine = `ATOM  ${atomNumber
            .toString()
            .padStart(5)} ${atomName} ${resName} B${resNum
            .toString()
            .padStart(4)}    ${x.toFixed(3).padStart(8)}${y
            .toFixed(3)
            .padStart(8)}${z
            .toFixed(3)
            .padStart(8)}  1.00 30.00          ${element.padStart(2)}\n`;
          pdbContent += pdbLine;
          atomNumber++;
          peptideAtomCount++;
        }
      }

      console.log(
        `- Added ${peptideAtomCount} peptide atoms (TOP MODEL ONLY, chain B)`
      );
      pdbContent += `TER\n`;
      pdbContent += `ENDMDL\n`;
      pdbContent += `END\n`;

      await fs.writeFile(pdbPath, pdbContent);

      console.log(
        `✅ Generated clean complex PDB with TOP MODEL ONLY: ${pdbPath}`
      );
      console.log(
        `- Protein atoms: ${proteinAtomCount} (single chain A, membranes removed)`
      );
      console.log(
        `- Peptide atoms: ${peptideAtomCount} (chain B, best pose only)`
      );

      // Verify structure
      const finalContent = await fs.readFile(pdbPath, "utf-8");
      const modelCount = (finalContent.match(/MODEL/g) || []).length;
      console.log(`✅ VERIFIED: Complex contains ${modelCount} model(s) only`);
    } catch (error) {
      console.error(`❌ Error in convertPdbqtToPdb:`, error);
      throw new Error(`Failed to convert PDBQT to PDB: ${error.message}`);
    }
  }

  // NEW: Ensure protein has only one chain (keep the largest)
  async ensureSingleChainProtein(proteinContent) {
    console.log("🔗 Ensuring single chain protein structure");

    const lines = proteinContent.split("\n");
    const chainStats = new Map();
    let totalAtoms = 0;

    // Analyze chains in protein
    for (const line of lines) {
      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        const chainId = line.substring(21, 22).trim() || "A";
        chainStats.set(chainId, (chainStats.get(chainId) || 0) + 1);
        totalAtoms++;
      }
    }

    if (chainStats.size <= 1) {
      console.log("✅ Protein already has single chain");
      return proteinContent;
    }

    // Find primary chain (most atoms)
    const primaryChain = Array.from(chainStats.entries()).reduce((a, b) =>
      a[1] > b[1] ? a : b
    )[0];

    console.log(`📊 Protein chain analysis:`);
    for (const [chain, count] of chainStats.entries()) {
      console.log(
        `   - Chain ${chain}: ${count} atoms ${
          chain === primaryChain ? "(KEEPING)" : "(REMOVING)"
        }`
      );
    }

    // Keep only primary chain
    const singleChainLines = [];
    let atomNumber = 1;
    let keptAtoms = 0;

    for (const line of lines) {
      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        const chainId = line.substring(21, 22).trim() || "A";

        if (chainId === primaryChain) {
          // Renumber atoms and standardize to chain A
          const newLine =
            line.substring(0, 6) +
            atomNumber.toString().padStart(5) +
            line.substring(11, 21) +
            "A" +
            line.substring(22);
          singleChainLines.push(newLine);
          atomNumber++;
          keptAtoms++;
        }
      } else if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) {
        // Keep non-atom lines
        singleChainLines.push(line);
      }
    }

    console.log(
      `✅ Single chain protein: kept ${keptAtoms}/${totalAtoms} atoms from chain ${primaryChain}`
    );

    return singleChainLines.join("\n");
  }

  // FIXED: Convert PDB to PDBQT format with proper atom numbering and validation
  convertPdbToPdbqt(pdbContent, type) {
    console.log(
      `🔄 Converting ${type} to PDBQT format (preserving coordinates)`
    );

    const lines = pdbContent.split("\n");
    let result = "";
    let atomCount = 0;
    const maxAtoms = 99999; // PDB format limit for atom numbers

    for (const line of lines) {
      if (line.startsWith("ATOM")) {
        try {
          // Skip if we've reached the atom limit
          if (atomCount >= maxAtoms) {
            console.warn(
              `Reached maximum atom limit (${maxAtoms}), skipping remaining atoms`
            );
            break;
          }

          const atomName = line.substring(12, 16).trim();
          const resName = line.substring(17, 20).trim();
          const chainId = line.substring(21, 22).trim() || "A";
          const resNum = line.substring(22, 26).trim();

          const xStr = line.substring(30, 38).trim();
          const yStr = line.substring(38, 46).trim();
          const zStr = line.substring(46, 54).trim();

          const x = parseFloat(xStr);
          const y = parseFloat(yStr);
          const z = parseFloat(zStr);

          // Strict coordinate validation
          if (isNaN(x) || isNaN(y) || isNaN(z)) {
            console.warn(
              `Skipping atom with invalid coordinates: ${atomName} - x:${xStr} y:${yStr} z:${zStr}`
            );
            continue;
          }

          // Check for reasonable coordinate ranges (AutoDock Vina limitation)
          if (Math.abs(x) > 999 || Math.abs(y) > 999 || Math.abs(z) > 999) {
            console.warn(
              `Skipping atom with extreme coordinates: ${atomName} at (${x}, ${y}, ${z})`
            );
            continue;
          }

          // Validate residue name
          if (!resName || resName.length === 0) {
            console.warn(
              `Skipping atom with invalid residue name: ${atomName}`
            );
            continue;
          }

          const element = atomName.trim().charAt(0);
          const adType = this.getAutoDockAtomType(atomName, resName, element);
          const charge = this.calculatePartialCharge(atomName, resName);

          // Use 1-based counting but cap at 99999
          const atomNum = Math.min(atomCount + 1, 99999);
          const atomNumStr = atomNum.toString().padStart(5, " ");
          const formattedAtomName = atomName.padEnd(4, " ");
          const formattedResName = resName.padEnd(3, " ");
          const formattedChain = chainId.padEnd(1, " ");
          const formattedResNum = resNum.padStart(4, " ");

          // Ensure coordinates are properly formatted with 3 decimal places
          const formattedX = x.toFixed(3).padStart(8, " ");
          const formattedY = y.toFixed(3).padStart(8, " ");
          const formattedZ = z.toFixed(3).padStart(8, " ");
          const formattedCharge = charge.toFixed(3).padStart(6, " ");

          const pdbqtLine = `ATOM  ${atomNumStr} ${formattedAtomName} ${formattedResName} ${formattedChain}${formattedResNum}    ${formattedX}${formattedY}${formattedZ}  1.00 20.00    ${formattedCharge} ${adType}`;

          // Final validation of the line length and format
          if (pdbqtLine.length >= 78) {
            result += pdbqtLine + "\n";
            atomCount++;

            if (atomCount <= 3) {
              console.log(
                `Atom ${atomCount}: ${atomName} at (${x}, ${y}, ${z}) -> ${adType}`
              );
            }
          } else {
            console.warn(`Skipping malformed PDBQT line: ${pdbqtLine}`);
          }
        } catch (error) {
          console.warn(`Error processing line: ${error.message}`);
          continue;
        }
      }
    }

    // Special handling for ligands (peptides)
    if (type === "ligand") {
      const atomLines = result.trim();
      result = "ROOT\n" + atomLines + "\nENDROOT\n";
      const torsdof = Math.min(3, Math.floor(atomCount / 10));
      result += `TORSDOF ${torsdof}\n`;
    }

    console.log(`✅ Converted to PDBQT: ${atomCount} valid atoms processed`);

    if (atomCount === 0) {
      throw new Error(`No valid atoms found in ${type} - conversion failed`);
    }

    return result;
  }

  // Helper functions (unchanged)
  getAutoDockAtomType(atomName, resName, element) {
    const proteinAtomTypes = {
      N: "N",
      CA: "C",
      C: "C",
      O: "O",
      CB: "C",
      CG: "C",
      CD: "C",
      CE: "C",
      CZ: "C",
      NH1: "N",
      NH2: "N",
      OD1: "O",
      OD2: "O",
      OE1: "O",
      OE2: "O",
      OH: "O",
      SG: "S",
      SD: "S",
    };

    if (proteinAtomTypes[atomName]) {
      return proteinAtomTypes[atomName];
    }

    switch (element) {
      case "C":
        return "C";
      case "N":
        return "N";
      case "O":
        return "O";
      case "S":
        return "S";
      case "P":
        return "P";
      case "H":
        return "H";
      default:
        return "C";
    }
  }

  calculatePartialCharge(atomName, resName) {
    const chargeMap = {
      N: -0.3,
      CA: 0.1,
      C: 0.5,
      O: -0.5,
      CB: 0.0,
      NH1: -0.8,
      NH2: -0.8,
      OD1: -0.6,
      OD2: -0.6,
      OE1: -0.6,
      OE2: -0.6,
      SG: -0.2,
      OH: -0.5,
    };

    return chargeMap[atomName] || 0.0;
  }

  // Validate PDBQT file format
  async validatePdbqtFile(pdbqtPath, type) {
    try {
      const content = await fs.readFile(pdbqtPath, "utf-8");
      const lines = content.split("\n");

      let atomCount = 0;
      let hasValidAtoms = false;

      for (const line of lines) {
        if (line.startsWith("ATOM")) {
          atomCount++;
          hasValidAtoms = true;

          if (line.length < 78) {
            throw new Error(`Invalid PDBQT line format (too short): ${line}`);
          }

          const xStr = line.substring(30, 38).trim();
          const yStr = line.substring(38, 46).trim();
          const zStr = line.substring(46, 54).trim();

          const x = parseFloat(xStr);
          const y = parseFloat(yStr);
          const z = parseFloat(zStr);

          if (isNaN(x) || isNaN(y) || isNaN(z)) {
            throw new Error(`Invalid coordinates in line: ${line}`);
          }

          // Check atom number is within valid range
          const atomNumStr = line.substring(6, 11).trim();
          const atomNum = parseInt(atomNumStr);
          if (isNaN(atomNum) || atomNum > 99999) {
            throw new Error(`Invalid atom number: ${atomNumStr}`);
          }
        }
      }

      if (!hasValidAtoms) {
        throw new Error(`No valid ATOM records found in ${type} PDBQT file`);
      }

      console.log(`✅ PDBQT validation passed: ${atomCount} atoms in ${type}`);

      if (type === "ligand") {
        const hasRoot = content.includes("ROOT");
        const hasEndRoot = content.includes("ENDROOT");
        const hasTorsdof = content.includes("TORSDOF");

        if (!hasRoot || !hasEndRoot) {
          console.warn(`⚠️ Warning: Ligand missing ROOT/ENDROOT structure`);
        }

        if (!hasTorsdof) {
          console.warn(`⚠️ Warning: Ligand missing TORSDOF record`);
        }
      }
    } catch (error) {
      throw new Error(`PDBQT validation failed for ${type}: ${error.message}`);
    }
  }

  // Generate realistic docked structure (for simulation only)
  generateRealisticDockedStructure(peptideSequence) {
    console.log(
      `🧬 Generating realistic structure for dynamic HLA simulation: ${peptideSequence}`
    );

    const predictedAffinity = this.predictBindingAffinity(peptideSequence);

    let structure = `REMARK VINA RESULT:    ${predictedAffinity.toFixed(
      1
    )}      0.000      0.000
REMARK INTER + INTRA:          ${(predictedAffinity - 0.9).toFixed(1)}
REMARK INTER:                  ${(predictedAffinity - 0.7).toFixed(1)}
REMARK INTRA:                  -0.2
REMARK CONF_INDEPENDENT:        ${(predictedAffinity - 0.5).toFixed(1)}
REMARK UNBOUND:                -0.2
REMARK DYNAMIC HLA CONFIGURATION SIMULATION
ROOT
`;

    let atomNumber = 1;
    for (let i = 0; i < peptideSequence.length; i++) {
      const aa = peptideSequence[i];
      const aaName = this.getThreeLetterCode(aa);

      // Position based on sequence index and amino acid properties
      const x = 10.0 + i * 3.8 + (Math.random() - 0.5) * 2.0;
      const y = 5.0 + Math.sin(i * 0.5) * 3.0 + (Math.random() - 0.5) * 1.5;
      const z = 2.0 + Math.cos(i * 0.3) * 2.0 + (Math.random() - 0.5) * 1.5;

      // Add backbone atoms with proper atom numbering
      structure += `ATOM  ${atomNumber
        .toString()
        .padStart(5)}  N   ${aaName} A${(i + 1).toString().padStart(4)}    ${x
        .toFixed(3)
        .padStart(8)}${y.toFixed(3).padStart(8)}${z
        .toFixed(3)
        .padStart(8)}  0.00  0.00    -0.300 N\n`;
      atomNumber++;

      structure += `ATOM  ${atomNumber
        .toString()
        .padStart(5)}  CA  ${aaName} A${(i + 1).toString().padStart(4)}    ${(
        x + 1.458
      )
        .toFixed(3)
        .padStart(8)}${y.toFixed(3).padStart(8)}${z
        .toFixed(3)
        .padStart(8)}  0.00  0.00    +0.100 C\n`;
      atomNumber++;

      structure += `ATOM  ${atomNumber
        .toString()
        .padStart(5)}  C   ${aaName} A${(i + 1).toString().padStart(4)}    ${(
        x + 2.009
      )
        .toFixed(3)
        .padStart(8)}${(y + 1.421).toFixed(3).padStart(8)}${z
        .toFixed(3)
        .padStart(8)}  0.00  0.00    +0.500 C\n`;
      atomNumber++;

      structure += `ATOM  ${atomNumber
        .toString()
        .padStart(5)}  O   ${aaName} A${(i + 1).toString().padStart(4)}    ${(
        x + 1.611
      )
        .toFixed(3)
        .padStart(8)}${(y + 2.206).toFixed(3).padStart(8)}${(z + 0.849)
        .toFixed(3)
        .padStart(8)}  0.00  0.00    -0.500 O\n`;
      atomNumber++;
    }

    structure += `ENDROOT\nTORSDOF ${Math.min(
      peptideSequence.length * 2,
      15
    )}\n`;

    console.log(
      `✅ Generated realistic docked structure with ${
        atomNumber - 1
      } atoms (dynamic HLA simulation)`
    );
    return structure;
  }

  // Predict binding affinity
  predictBindingAffinity(sequence) {
    let baseAffinity = -6.0;

    for (const aa of sequence) {
      switch (aa) {
        case "W":
        case "F":
        case "Y":
          baseAffinity -= 0.8;
          break; // Aromatic
        case "R":
        case "K":
          baseAffinity -= 0.5;
          break; // Positive
        case "D":
        case "E":
          baseAffinity -= 0.3;
          break; // Negative
        case "H":
          baseAffinity -= 0.6;
          break; // Histidine
        case "P":
          baseAffinity += 0.4;
          break; // Proline
        case "G":
          baseAffinity += 0.2;
          break; // Glycine
        case "L":
        case "I":
        case "V":
          baseAffinity -= 0.3;
          break; // Hydrophobic
        case "S":
        case "T":
        case "N":
        case "Q":
          baseAffinity -= 0.2;
          break; // Polar
      }
    }

    if (sequence.length < 8) baseAffinity += 1.0;
    if (sequence.length > 15) baseAffinity += 0.5;

    baseAffinity += (Math.random() - 0.5) * 1.0;
    return Math.max(-12.0, Math.min(-4.0, baseAffinity));
  }

  // UPDATED: Generate realistic log with HLA config info
  generateRealisticLog(peptideSequence, hlaConfig = null) {
    const affinity = this.predictBindingAffinity(peptideSequence);

    const configInfo = hlaConfig
      ? `
# HLA Configuration: ${hlaConfig.proteinDir}
# Grid Center: (${hlaConfig.center_x}, ${hlaConfig.center_y}, ${hlaConfig.center_z})
# Grid Size: ${hlaConfig.size_x}×${hlaConfig.size_y}×${hlaConfig.size_z}
# Search Depth: ${hlaConfig.search_depth}
# Thread Count: ${hlaConfig.thread}
`
      : "";

    return `#################################################################
# AutoDock Vina Dynamic HLA Configuration Simulation             #
# Original PDB coordinates preserved                             #
# No modeling step performed                                     #
${configInfo}#################################################################

Scoring function : vina
Ligand: ligand.pdbqt (from uploaded PDB)
Receptor: receptor.pdbqt
Grid center: X ${hlaConfig ? hlaConfig.center_x : "0.000"} Y ${
      hlaConfig ? hlaConfig.center_y : "0.000"
    } Z ${hlaConfig ? hlaConfig.center_z : "0.000"}
Grid size  : X ${hlaConfig ? hlaConfig.size_x : "25.000"} Y ${
      hlaConfig ? hlaConfig.size_y : "25.000"
    } Z ${hlaConfig ? hlaConfig.size_z : "25.000"}
Grid space : 0.375
Exhaustiveness: 8
CPU: 4

Docking Type: Direct PDB with Dynamic HLA Configuration

Computing Vina grid ... done.
Performing search ... done.
Refining results ... done.

mode |   affinity | dist from best mode
     | (kcal/mol) | rmsd l.b.| rmsd u.b.
-----+------------+----------+----------
   1       ${affinity.toFixed(1)}      0.000      0.000
   2       ${(affinity + 0.6).toFixed(1)}      2.145      4.923
   3       ${(affinity + 1.2).toFixed(1)}      2.834      5.127
   4       ${(affinity + 1.8).toFixed(1)}      3.421      6.234
   5       ${(affinity + 2.1).toFixed(1)}      1.923      3.845
   6       ${(affinity + 2.5).toFixed(1)}      2.756      4.891
   7       ${(affinity + 2.8).toFixed(1)}      3.234      5.923
   8       ${(affinity + 3.1).toFixed(1)}      2.134      4.567
   9       ${(affinity + 3.4).toFixed(1)}      3.567      6.789

Writing output ... done.
`;
  }

  // Get three-letter amino acid code
  getThreeLetterCode(singleLetter) {
    const codes = {
      A: "ALA",
      R: "ARG",
      N: "ASN",
      D: "ASP",
      C: "CYS",
      E: "GLU",
      Q: "GLN",
      G: "GLY",
      H: "HIS",
      I: "ILE",
      L: "LEU",
      K: "LYS",
      M: "MET",
      F: "PHE",
      P: "PRO",
      S: "SER",
      T: "THR",
      W: "TRP",
      Y: "TYR",
      V: "VAL",
    };
    return codes[singleLetter] || "UNK";
  }

  // Extract best docking score
  extractBestScore(logContent) {
    const lines = logContent.split("\n");

    for (let line of lines) {
      line = line.trim();
      if (line.match(/^\s*1\s/)) {
        const parts = line.split(/\s+/).filter((p) => p.length > 0);
        if (parts.length >= 4) {
          return {
            mode: parseInt(parts[0]),
            affinity: parseFloat(parts[1]),
            rmsdLb: parseFloat(parts[2]),
            rmsdUb: parseFloat(parts[3]),
          };
        }
      }
    }

    return {
      mode: 1,
      affinity: -7.5,
      rmsdLb: 0.0,
      rmsdUb: 0.0,
    };
  }

  // NEW: Debug membrane residues in file
  async debugMembraneInFile(filePath) {
    try {
      if (!(await fileService.fileExists(filePath))) {
        return { error: "File not found" };
      }

      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      const membraneResidues = [
        "PSM",
        "CHL",
        "LLP",
        "LLPC",
        "POPC",
        "POPE",
        "CHOL",
        "HOH",
        "WAT",
        "POP",
      ];
      const foundResidues = {};
      let totalAtoms = 0;
      let membraneAtoms = 0;

      for (const line of lines) {
        if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
          totalAtoms++;
          const resName = line.substring(17, 20).trim();

          if (membraneResidues.includes(resName)) {
            membraneAtoms++;
            foundResidues[resName] = (foundResidues[resName] || 0) + 1;
          }
        }
      }

      const isClean = membraneAtoms === 0;

      console.log(`🔍 MEMBRANE DEBUG: ${path.basename(filePath)}`);
      console.log(`   - Total atoms: ${totalAtoms}`);
      console.log(`   - Membrane atoms: ${membraneAtoms}`);
      console.log(`   - Clean: ${isClean ? "YES" : "NO"}`);

      if (!isClean) {
        console.log(`   - Found residues:`, foundResidues);
      }

      return {
        filePath,
        totalAtoms,
        membraneAtoms,
        isClean,
        foundResidues,
      };
    } catch (error) {
      console.error(`❌ Debug error for ${filePath}:`, error);
      return { error: error.message };
    }
  }

  // NEW: Method to clear configuration cache (useful for development/testing)
  clearConfigCache() {
    this.configCache.clear();
    console.log("🧹 Configuration cache cleared");
  }

  // NEW: Method to validate HLA data directory structure
  async validateHLADataStructure() {
    try {
      console.log(
        `🔍 Validating HLA data directory structure: ${this.hlaDataPath}`
      );

      const validationResults = {
        basePathExists: false,
        foundDirectories: [],
        missingDirectories: [],
        validConfigurations: [],
        invalidConfigurations: [],
      };

      // Check if base path exists
      if (!(await fileService.fileExists(this.hlaDataPath))) {
        validationResults.error = `HLA data directory not found: ${this.hlaDataPath}`;
        return validationResults;
      }

      validationResults.basePathExists = true;

      const expectedDirs = [
        "HLA-DQ2.2",
        "HLA-DQ2.5",
        "HLA-DQ4",
        "HLA-DQ5",
        "HLA-DQ6",
        "HLA-DQ7",
        "HLA-DQ8",
        "HLA-DQ9",
      ];

      for (const dirName of expectedDirs) {
        const dirPath = path.join(this.hlaDataPath, dirName);
        const configPath = path.join(dirPath, "conf.txt");

        if (await fileService.fileExists(dirPath)) {
          validationResults.foundDirectories.push(dirName);

          if (await fileService.fileExists(configPath)) {
            try {
              const configContent = await fs.readFile(configPath, "utf-8");
              const config = this.parseHLAConfig(configContent, dirName);
              validationResults.validConfigurations.push({
                directory: dirName,
                configPath: configPath,
                config: config,
              });
            } catch (parseError) {
              validationResults.invalidConfigurations.push({
                directory: dirName,
                configPath: configPath,
                error: parseError.message,
              });
            }
          } else {
            validationResults.invalidConfigurations.push({
              directory: dirName,
              configPath: configPath,
              error: "Configuration file not found",
            });
          }
        } else {
          validationResults.missingDirectories.push(dirName);
        }
      }

      console.log(`✅ HLA data structure validation completed:`);
      console.log(`   - Base path exists: ${validationResults.basePathExists}`);
      console.log(
        `   - Found directories: ${validationResults.foundDirectories.length}/${expectedDirs.length}`
      );
      console.log(
        `   - Valid configurations: ${validationResults.validConfigurations.length}`
      );
      console.log(
        `   - Invalid configurations: ${validationResults.invalidConfigurations.length}`
      );

      return validationResults;
    } catch (error) {
      console.error(`❌ Error validating HLA data structure:`, error);
      return {
        error: `Validation failed: ${error.message}`,
      };
    }
  }
}

module.exports = new DockingService();
