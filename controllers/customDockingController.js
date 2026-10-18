const Protein = require("../models/Protein");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);
const validator = require("validator");

// Import services
const peptideService = require("../services/peptideService");
const dockingService = require("../services/dockingService");
const fileService = require("../services/fileService");
const haddock3Service = require("../services/haddock3Service");
const restraintsService = require("../services/restraintsService");
const rcsbService = require("../services/rcsbService");

const dockingProgress = new Map();
const FINAL_HADDOCK_PEPTIDE_ROOT = path.resolve(
  __dirname,
  "../Final_HADDOCK_Peptide/Final_HADDOCK_Peptide"
);
const FINAL_HADDOCK_CONFORMATIONS = ["ensemble", "helix", "ppii", "sheet"];
const PREP_SESSION_COOKIE = "celiacdb_prep_session";

function getCookieValue(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  const cookie = cookies.find((entry) => entry.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.trim().slice(name.length + 1)) : "";
}

function setDockingProgress(sessionId, update) {
  const previous = dockingProgress.get(sessionId) || {};
  dockingProgress.set(sessionId, {
    ...previous,
    ...update,
    sessionId,
    updatedAt: new Date().toISOString(),
  });
}

async function getFinalHaddockPeptideLibrary(proteins) {
  let directories;
  try {
    directories = await fs.readdir(FINAL_HADDOCK_PEPTIDE_ROOT, { withFileTypes: true });
  } catch (error) {
    console.error("Unable to read prepared HADDOCK peptide folder:", error.message);
    return [];
  }

  const proteinByPrefix = proteins
    .map((protein) => ({
      protein,
      prefix: String(protein.name || "").replace(/^HLA[-\s]?/i, "").replace(/\s+/g, "").toUpperCase(),
    }))
    .filter(({ prefix }) => prefix);

  const library = [];
  for (const directory of directories.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const files = {};
    for (const conformation of FINAL_HADDOCK_CONFORMATIONS) {
      const filename = `peptide_${conformation === "ensemble" ? "ens" : conformation}.pdb`;
      const filePath = path.join(FINAL_HADDOCK_PEPTIDE_ROOT, directory.name, filename);
      try {
        await fs.access(filePath);
        files[conformation] = `final-haddock/${directory.name}/${filename}`;
      } catch (_) {
        // A dataset is listed only with the conformations that actually exist.
      }
    }
    if (Object.keys(files).length === 0) continue;

    const proteinMatch = proteinByPrefix.find(({ prefix }) =>
      directory.name.toUpperCase().startsWith(prefix)
    );
    library.push({
      proteinId: proteinMatch ? proteinMatch.protein._id.toString() : "",
      proteinName: proteinMatch ? proteinMatch.protein.name : "Prepared HADDOCK peptides",
      peptideName: directory.name,
      conformations: files,
    });
  }
  return library;
}

async function buildDockingCacheKey({ proteinId, receptorPath, peptidePath, engine, configContent, receptorActiveResidues, peptideActiveResidues }) {
  const hash = crypto.createHash("sha256");
  hash.update(String(proteinId));
  hash.update("\0");
  hash.update(String(engine).toLowerCase());
  hash.update("\0");
  hash.update(String(configContent || ""));
  hash.update("\0");
  hash.update(String(receptorActiveResidues || ""));
  hash.update("\0");
  hash.update(String(peptideActiveResidues || ""));
  hash.update("\0");
  hash.update(await fs.readFile(receptorPath));
  hash.update("\0");
  hash.update(await fs.readFile(peptidePath));
  return hash.digest("hex");
}

async function findCachedDockingResult(cacheKey, criteria = {}) {
  const tempDir = path.join(__dirname, "../temp_results");
  let files = [];
  try {
    files = await fs.readdir(tempDir);
  } catch (_) {
    return null;
  }

  for (const file of files.filter((name) => name.startsWith("session_") && name.endsWith(".json"))) {
    try {
      const result = JSON.parse(await fs.readFile(path.join(tempDir, file), "utf8"));
      if (!result.sessionId) continue;
      const sessionDir = path.join(tempDir, result.sessionId);
      await fs.access(path.join(sessionDir, "complex.pdb"));

      // Older Vina result files did not persist `engine`, and regenerated
      // library PDBs can have different formatting while representing the
      // same peptide. Reuse those results using stable docking metadata.
      const requestedEngine = String(criteria.engine || "").toLowerCase();
      const resultEngine = String(result.engine || "").toLowerCase();
      const isHaddockResult = resultEngine === "haddock3"
        || Boolean(result.haddockMetrics)
        || String(result.dockingMethod || "").toUpperCase().includes("HADDOCK");
      if (requestedEngine === "vina" && isHaddockResult) continue;
      if (requestedEngine === "haddock3" && !isHaddockResult) continue;
      // Never reuse legacy HADDOCK sessions that may contain benchmark or
      // synthetic scores. Real results are marked when the CLI completes.
      if (requestedEngine === "haddock3" && result.realHaddockRun !== true) continue;
      if (result.cacheKey === cacheKey) return result;
      const effectiveResultEngine = resultEngine || (isHaddockResult ? "haddock3" : "vina");

      const sameMetadata = effectiveResultEngine === requestedEngine
        && String(result.protein?._id || "") === String(criteria.proteinId || "")
        && String(result.peptideSequence || "").toUpperCase() === String(criteria.peptideSequence || "").toUpperCase()
        && Boolean(result.customConfigUsed) === Boolean(criteria.customConfigContent);
      if (sameMetadata) {
        return result;
      }
    } catch (_) {}
  }
  return null;
}

// Helper functions
function validatePeptideSequence(sequence, options = {}) {
  const config = {
    minLength: options.minLength || 3,
    maxLength: options.maxLength || 50,
    allowedChars: options.allowedChars || "ACDEFGHIKLMNPQRSTVWY",
    ...options,
  };

  // Input sanitization
  if (typeof sequence !== "string") {
    return { valid: false, error: "Sequence must be a string" };
  }

  // Clean and normalize
  const cleanSequence = sequence
    .replace(/\s+/g, "") // Remove whitespace
    .replace(/[^A-Za-z]/g, "") // Remove non-letters
    .toUpperCase();

  // Basic checks
  if (cleanSequence.length === 0) {
    return { valid: false, error: "Empty sequence after cleaning" };
  }

  if (cleanSequence.length < config.minLength) {
    return {
      valid: false,
      error: `Sequence too short (minimum ${config.minLength} amino acids)`,
    };
  }

  if (cleanSequence.length > config.maxLength) {
    return {
      valid: false,
      error: `Sequence too long (maximum ${config.maxLength} amino acids)`,
    };
  }

  // Character validation
  const validCharsRegex = new RegExp(`^[${config.allowedChars}]+$`);
  if (!validCharsRegex.test(cleanSequence)) {
    const invalidChars = cleanSequence
      .split("")
      .filter((char) => !config.allowedChars.includes(char))
      .join("");
    return {
      valid: false,
      error: `Invalid amino acid codes found: ${invalidChars}`,
    };
  }

  return {
    valid: true,
    cleanSequence,
    originalLength: sequence.length,
    cleanedLength: cleanSequence.length,
  };
}

function threeToOneLetter(threeLetter) {
  const conversionMap = {
    ALA: "A",
    ARG: "R",
    ASN: "N",
    ASP: "D",
    CYS: "C",
    GLN: "Q",
    GLU: "E",
    GLY: "G",
    HIS: "H",
    ILE: "I",
    LEU: "L",
    LYS: "K",
    MET: "M",
    PHE: "F",
    PRO: "P",
    SER: "S",
    THR: "T",
    TRP: "W",
    TYR: "Y",
    VAL: "V",
  };

  return conversionMap[threeLetter.toUpperCase()] || null;
}

// UPDATED: PDB-only file processing function
function parsePDBFile(content) {
  console.log("🧬 Parsing PDB format for direct docking...");

  // SECURITY: Validate PDB file structure
  if (!content.includes("ATOM") && !content.includes("HETATM")) {
    throw new Error("Invalid PDB file - no ATOM records found");
  }

  // Extract sequence from PDB file
  const lines = content.split("\n");
  const sequenceMap = new Map();

  for (const line of lines) {
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      try {
        // Parse PDB ATOM line format
        const resName = line.substring(17, 20).trim();
        const resSeq = parseInt(line.substring(22, 26).trim());

        if (!isNaN(resSeq)) {
          // Convert 3-letter amino acid codes to 1-letter
          const oneLetterCode = threeToOneLetter(resName);
          if (oneLetterCode) {
            sequenceMap.set(resSeq, oneLetterCode);
          }
        }
      } catch (error) {
        // Skip malformed lines
        continue;
      }
    }
  }

  if (sequenceMap.size === 0) {
    throw new Error("No valid amino acid residues found in PDB file");
  }

  // Sort by residue number and join
  const sortedResidues = Array.from(sequenceMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);

  const sequence = sortedResidues.join("");
  console.log(`✅ Extracted sequence from PDB: ${sequence}`);

  return sequence;
}

// UPDATED: PDB-only file processing
async function processPDBFile(filePath, originalFilename, options = {}) {
  const maxFileSize = options.maxFileSize || 16 * 1024 * 1024; // 16MB for PDB files

  try {
    console.log(`🔍 Processing PDB file: ${originalFilename} at ${filePath}`);

    // Get extension from original filename
    const ext = path.extname(originalFilename).toLowerCase();
    console.log(`📋 File extension: ${ext}`);

    if (ext !== ".pdb") {
      throw new Error(
        `Invalid file extension: ${ext}. Only .pdb files are supported for direct docking.`
      );
    }

    // SECURITY: Check if file path exists and is valid
    if (!filePath || typeof filePath !== "string" || filePath.trim() === "") {
      throw new Error("Invalid file path provided");
    }

    // SECURITY: Check file size on disk
    const stats = await fs.stat(filePath);
    if (stats.size > maxFileSize) {
      throw new Error(
        `File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB (max: ${
          maxFileSize / 1024 / 1024
        }MB)`
      );
    }

    if (stats.size === 0) {
      throw new Error("File is empty");
    }

    // SECURITY: Read file content safely with encoding validation
    let fileContent;
    try {
      fileContent = await fs.readFile(filePath, "utf-8");
    } catch (encodingError) {
      throw new Error(
        "File encoding error - only UTF-8 PDB files are supported"
      );
    }

    // SECURITY: Check for null bytes (potential binary content)
    if (fileContent.includes("\0")) {
      throw new Error("File contains null bytes - binary content not allowed");
    }

    // SECURITY: Limit content length (16MB should be plenty for PDB)
    if (fileContent.length > 50000000) {
      // ~50MB of text
      throw new Error("File content too long");
    }

    // SECURITY: Check for suspicious content patterns
    const suspiciousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // Script tags
      /javascript:/gi, // JavaScript URLs
      /vbscript:/gi, // VBScript URLs
      /data:.*base64/gi, // Base64 data URLs
      /\beval\s*\(/gi, // eval() calls
      /\bexec\s*\(/gi, // exec() calls
      /\$\{.*\}/g, // Template injection
      /#include\s+[<"]/gi, // C includes
      /import\s+.*from/gi, // ES6 imports
      /require\s*\(/gi, // Node.js requires
      /\.\.\/.*\.\./g, // Directory traversal
      /\bFILE\s*\*|fopen|fwrite|system\(/gi, // C file operations
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(fileContent)) {
        console.warn(`🚨 Suspicious content pattern detected: ${pattern}`);
        throw new Error("File contains suspicious content patterns");
      }
    }

    // Process PDB file
    console.log("📋 Processing PDB file for direct docking...");
    const sequence = parsePDBFile(fileContent);

    // SECURITY: Final sequence validation
    const validation = validatePeptideSequence(sequence, options);
    if (!validation.valid) {
      throw new Error(
        `Invalid peptide sequence extracted from PDB: ${validation.error}`
      );
    }

    const cleanSequence = validation.cleanSequence;

    console.log(
      `✅ PDB file processed successfully. Sequence: ${cleanSequence} (${cleanSequence.length} aa)`
    );

    return {
      sequence: cleanSequence,
      pdbFilePath: filePath, // Keep original PDB file path for direct docking
      extractedFromPDB: true,
    };
  } catch (error) {
    console.error(`🚨 PDB file processing failed: ${error.message}`);
    throw new Error(`PDB file processing failed: ${error.message}`);
  }
}

// UPDATED: Direct PDB docking function with protein name parameter and options
async function performDirectPDBDocking(
  proteinId,
  pdbFilePath,
  peptideSequence,
  options = {}
) {
  const sessionId = options.progressSessionId || generateSessionId();
  const updateProgress = (update) => setDockingProgress(sessionId, update);
  const tempDir = path.join(__dirname, "../temp_results");
  const sessionDir = path.join(tempDir, sessionId);

  const selectedEngine = (options.engine || "vina").toLowerCase();
  console.log(`🔬 DIRECT PDB DOCKING PROCESS STARTED (Engine: ${selectedEngine.toUpperCase()})`);
  console.log(`Session ID: ${sessionId}`);
  console.log(`Peptide: ${peptideSequence} (${peptideSequence.length} aa)`);
  console.log(`Using direct PDB file: ${pdbFilePath}`);
  updateProgress({ status: "running", percent: 5, stage: "input", detail: "Starting backend docking process..." });

  try {
    // Ensure directories exist
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(sessionDir, { recursive: true });
    updateProgress({ percent: 12, stage: "input", detail: "Preparing the uploaded peptide and receptor files..." });
    console.log(`📁 Created session directory: ${sessionDir}`);

    // Get protein data
    const protein = await Protein.findById(proteinId);
    if (!protein) {
      throw new Error("Protein not found");
    }
    console.log(`✅ Found protein: ${protein.name}`);

    const receptorPath = path.join(__dirname, "../public/uploads", protein.mainProteinFile);
    try {
      await fs.access(receptorPath);
    } catch (error) {
      throw new Error(
        `Receptor PDB file is missing for ${protein.name}: ${protein.mainProteinFile}. ` +
        "Restore the protein files under public/uploads or re-import the protein data."
      );
    }
    const cacheKey = await buildDockingCacheKey({
      proteinId,
      receptorPath,
      peptidePath: pdbFilePath,
      engine: selectedEngine,
      configContent: options.customConfigContent,
      receptorActiveResidues: options.receptorActiveResidues,
      peptideActiveResidues: options.peptideActiveResidues,
    });
    const cachedResult = await findCachedDockingResult(cacheKey, {
      engine: selectedEngine,
      proteinId,
      peptideSequence,
      customConfigContent: options.customConfigContent,
    });
    if (cachedResult) {
      updateProgress({ status: "completed", percent: 100, stage: "cache", detail: "An identical completed docking result was found and reused.", cached: true });
      console.log(`♻️ Reusing cached ${selectedEngine.toUpperCase()} result from session ${cachedResult.sessionId}`);
      return { sessionId: cachedResult.sessionId, cached: true };
    }

    // STEP 1: Copy PDB file to session directory (NO MODELING STEP)
    console.log("📁 Step 1: Copying PDB file for direct docking...");
    const peptidePdbPath = path.join(
      sessionDir,
      `peptide_${peptideSequence}.pdb`
    );
    await fs.copyFile(pdbFilePath, peptidePdbPath);
    console.log(`✅ PDB file copied to: ${peptidePdbPath}`);
    updateProgress({ percent: 18, stage: "input", detail: "PDB input copied into the docking session." });

    // Handle HADDOCK3 Engine
    if (selectedEngine === "haddock3") {
      console.log("⚡ Executing HADDOCK3 restraint-driven docking pipeline...");
      const receptorPath = path.join(
        __dirname,
        "../public/uploads",
        protein.mainProteinFile
      );

      const haddockResult = await haddock3Service.runDocking({
        protein,
        receptorPdbPath: receptorPath,
        peptidePdbPath: peptidePdbPath,
        peptideSequence,
        sessionDir,
        sessionId,
        updateProgress,
        customConfigContent: options.customConfigContent,
        receptorActiveResidues: options.receptorActiveResidues,
        peptideActiveResidues: options.peptideActiveResidues,
      });

      const peptideFileName = path.basename(peptidePdbPath);
      const resultData = {
        sessionId,
        cacheKey,
        engine: "haddock3",
        protein: {
          _id: protein._id,
          name: protein.name,
          mainProteinFile: protein.mainProteinFile,
        },
        peptideSequence,
        peptidePdbPath: `temp-results/${sessionId}/${peptideFileName}`,
        complexPdbPath: haddockResult.complexPath,
        cleanProteinPath: haddockResult.cleanProteinPath,
        logContent: haddockResult.logContent,
        configContent: haddockResult.configContent,
        restraintsContent: haddockResult.restraintsContent,
        haddockMetrics: haddockResult.metrics,
        realHaddockRun: !haddockResult.syntheticResult,
        bestScore: {
          affinity: haddockResult.metrics ? haddockResult.metrics.haddockScore : null,
          mode: haddockResult.metrics ? haddockResult.metrics.clusterRank : null,
          rmsdLb: haddockResult.metrics ? haddockResult.metrics.irmsd : null,
          rmsdUb: haddockResult.metrics ? haddockResult.metrics.lrmsd : null,
        },
        timestamp: new Date().toISOString(),
        dockingMethod: "HADDOCK3_RESTRAINT_DRIVEN_DOCKING",
        actualDocking: true,
        directPDBDocking: true,
        modelingSkipped: true,
        membranesRemoved: true,
        customConfigUsed: !!options.customConfigContent,
        activeRestraintsUsed: true,
        autoCleanupScheduled: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      const resultFilePath = path.join(tempDir, `${sessionId}.json`);
      await fs.writeFile(resultFilePath, JSON.stringify(resultData, null, 2));
      updateProgress({ status: "completed", percent: 100, stage: "complete", detail: "HADDOCK results are ready." });

      console.log(`✅ HADDOCK3 docking completed successfully for session: ${sessionId}`);
      return { sessionId };
    }

    // Step 2: Check if AutoDock Vina is available
    const vinaAvailable = await dockingService.checkVinaInstallation();

    if (vinaAvailable) {
      console.log(
        "✅ AutoDock Vina detected - performing REAL direct PDB docking"
      );

      // Step 3: Prepare receptor (protein)
      console.log("🧬 Step 2: Preparing receptor...");
      const receptorPath = path.join(
        __dirname,
        "../public/uploads",
        protein.mainProteinFile
      );
      const receptorPdbqtPath = await dockingService.prepareReceptor(
        receptorPath,
        sessionDir
      );

      // Step 4: Prepare ligand (direct PDB - no modeling)
      console.log("🧬 Step 3: Preparing ligand from PDB...");
      const ligandPdbqtPath = await dockingService.prepareLigand(
        peptidePdbPath,
        sessionDir
      );

      // Step 5: Perform actual docking with Vina - PASS PROTEIN NAME AND CUSTOM CONFIG
      console.log(
        "⚗️ Step 4: Performing REAL direct PDB docking with AutoDock Vina..."
      );
      const dockingResults = await dockingService.runAutoDockVina(
        receptorPdbqtPath,
        ligandPdbqtPath,
        sessionDir,
        protein.name,
        options.customConfigContent
      );

      // Step 6: Process results
      console.log("📊 Step 5: Processing REAL docking results...");
      const processedResults = await dockingService.processVinaDockingResults(
        dockingResults,
        protein,
        peptideSequence,
        sessionDir
      );

      const peptideFileName = path.basename(peptidePdbPath);

      // Save results to temporary storage
      const resultData = {
        sessionId,
        cacheKey,
        engine: "vina",
        protein: {
          _id: protein._id,
          name: protein.name,
          mainProteinFile: protein.mainProteinFile,
        },
        peptideSequence,
        peptidePdbPath: `temp-results/${sessionId}/${peptideFileName}`,
        complexPdbPath: processedResults.complexPath,
        cleanProteinPath: processedResults.cleanProteinPath,
        logContent: processedResults.logContent,
        bestScore: processedResults.bestScore,
        configContent: processedResults.configContent,
        hlaConfig: processedResults.hlaConfig, // Include HLA config info
        customConfigUsed: !!options.customConfigContent,
        timestamp: new Date().toISOString(),
        dockingMethod: options.customConfigContent ? "REAL_AUTODOCK_VINA_CUSTOM_CONFIG" : "REAL_AUTODOCK_VINA_DIRECT_PDB_DYNAMIC_HLA",
        actualDocking: true,
        directPDBDocking: true,
        modelingSkipped: true,
        membranesRemoved: true,
        membraneCleaningMethod: "COMPREHENSIVE_REMOVAL",
        dynamicHLAConfiguration: !options.customConfigContent,
        autoCleanupScheduled: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      const resultFilePath = path.join(tempDir, `${sessionId}.json`);
      await fs.writeFile(resultFilePath, JSON.stringify(resultData, null, 2));

      console.log(
        `✅ REAL direct PDB docking completed successfully for session: ${sessionId}`
      );
      return { sessionId };
    } else {
      console.log(
        "⚠️ AutoDock Vina NOT available - generating enhanced simulation for direct PDB"
      );

      // Generate enhanced simulated results for direct PDB - PASS PROTEIN OBJECT
      const simulatedResults = await dockingService.generateEnhancedSimulation(
        protein, // ← PASS FULL PROTEIN OBJECT
        peptideSequence,
        sessionDir
      );

      const peptideFileName = path.basename(peptidePdbPath);

      // Save simulated results
      const resultData = {
        sessionId,
        cacheKey,
        engine: "vina",
        protein: {
          _id: protein._id,
          name: protein.name,
          mainProteinFile: protein.mainProteinFile,
        },
        peptideSequence,
        peptidePdbPath: `temp-results/${sessionId}/${peptideFileName}`,
        complexPdbPath: simulatedResults.complexPath,
        cleanProteinPath: simulatedResults.cleanProteinPath,
        logContent: simulatedResults.logContent,
        bestScore: simulatedResults.bestScore,
        configContent: simulatedResults.configContent,
        hlaConfig: simulatedResults.hlaConfig, // Include HLA config info
        timestamp: new Date().toISOString(),
        dockingMethod: "ENHANCED_SIMULATION_DIRECT_PDB_DYNAMIC_HLA",
        actualDocking: false,
        directPDBDocking: true,
        modelingSkipped: true,
        membranesRemoved: true,
        membraneCleaningMethod: "COMPREHENSIVE_REMOVAL",
        dynamicHLAConfiguration: true, // NEW FLAG
        autoCleanupScheduled: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        warnings: [
          "These are simulated results, not actual docking calculations",
          "Install AutoDock Vina for real molecular docking",
          "Results should not be used for publication without experimental validation",
          "Direct PDB docking - modeling step was skipped",
          "All membranes have been removed for clear visualization",
          "Dynamic HLA-specific configuration applied",
          "Session will automatically expire in 24 hours",
        ],
      };

      const resultFilePath = path.join(tempDir, `${sessionId}.json`);
      await fs.writeFile(resultFilePath, JSON.stringify(resultData, null, 2));

      console.log(
        `⚠️ Enhanced simulation completed for direct PDB session: ${sessionId}`
      );
      return { sessionId };
    }
  } catch (error) {
    console.error(
      `❌ Direct PDB docking failed for session ${sessionId}:`,
      error
    );
    updateProgress({ status: "failed", percent: 100, stage: "error", detail: error.message, error: error.message });
    // Clean up on error
    try {
      await fs.rmdir(sessionDir, { recursive: true });
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError);
    }
    throw error;
  }
}

// Helper functions (unchanged)
function logSuspiciousActivity(req, type, details) {
  console.warn(`🚨 SUSPICIOUS ACTIVITY DETECTED:`);
  console.warn(`   Type: ${type}`);
  console.warn(`   IP: ${req.ip}`);
  console.warn(`   User-Agent: ${req.get("User-Agent")}`);
  console.warn(`   Details: ${details}`);
  console.warn(`   Timestamp: ${new Date().toISOString()}`);
}

function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function debugSessionFiles(sessionDir) {
  try {
    const files = await fs.readdir(sessionDir);
    console.log(`📁 Files in session directory:`, files);

    // Check specific files
    const expectedFiles = ["complex.pdb", "protein_clean.pdb"];
    const peptideFile = files.find((f) => f.startsWith("peptide_"));
    if (peptideFile) expectedFiles.push(peptideFile);

    for (const file of expectedFiles) {
      const filePath = path.join(sessionDir, file);
      if (await fileService.fileExists(filePath)) {
        const stats = await fs.stat(filePath);
        console.log(`✅ ${file}: ${stats.size} bytes`);

        // Check for membrane residues in files
        if (file === "complex.pdb" || file === "protein_clean.pdb") {
          const content = await fs.readFile(filePath, "utf-8");
          const membraneResidues = [
            "POPC",
            "POPE",
            "DPPC",
            "CHOL",
            "DMPC",
            "DOPC",
            "HOH",
            "WAT",
          ];
          const foundMembrane = membraneResidues.filter((res) =>
            content.includes(res)
          );

          if (foundMembrane.length > 0) {
            console.warn(
              `⚠️ ${file}: Found membrane residues: ${foundMembrane.join(", ")}`
            );
          } else {
            console.log(`✅ ${file}: Confirmed membrane-free`);
          }
        }
      } else {
        console.error(`❌ Missing file: ${file}`);
      }
    }
  } catch (error) {
    console.error(`❌ Error reading session directory:`, error);
  }
}

class CustomDockingController {
  async getRcsbReference(req, res) {
    try {
      const protein = await Protein.findById(req.params.proteinId).select("name").lean();
      if (!protein) return res.status(404).json({ error: "Protein not found" });

      const reference = await rcsbService.findReferenceStructure(protein.name);
      res.json({ proteinName: protein.name, reference });
    } catch (error) {
      console.error("RCSB reference lookup failed:", error.message);
      res.status(502).json({ error: "Unable to retrieve a reference structure from RCSB" });
    }
  }

  // Get custom docking form with optional pre-loaded peptide prep session
  async getCustomDockingForm(req, res) {
    try {
      const proteins = await Protein.find({ proteinType: "HLADQ" });
      const peptideLibrary = await getFinalHaddockPeptideLibrary(proteins);
      const prepSession =
        req.query.prepSession || getCookieValue(req, PREP_SESSION_COOKIE) || null;
      let preparedData = null;

      if (prepSession) {
        const safeSession = String(prepSession).replace(/[^a-zA-Z0-9_-]/g, "");
        const ensPath = path.join(__dirname, "../temp_results", safeSession, "peptide_ens.pdb");
        const infoPath = path.join(__dirname, "../temp_results", safeSession, "session_info.json");
        const jsonPath = path.join(__dirname, "../temp_results", `${safeSession}.json`);

        try {
          await fs.access(ensPath);
          let seq = "";
          try {
            let jsonRaw = "";
            try {
              jsonRaw = await fs.readFile(infoPath, "utf-8");
            } catch (_) {
              jsonRaw = await fs.readFile(jsonPath, "utf-8");
            }
            const parsed = JSON.parse(jsonRaw);
            seq = parsed.sequence || "";
          } catch (_) {}

          preparedData = {
            sessionId: safeSession,
            ensPath,
            sequence: seq,
          };
          res.setHeader(
            "Set-Cookie",
            `${PREP_SESSION_COOKIE}=${encodeURIComponent(safeSession)}; Max-Age=86400; Path=/; SameSite=Lax`
          );
          console.log(`🧬 Loaded pre-prepared peptide ensemble from session ${safeSession} for sequence ${seq}`);
        } catch (_) {
          console.warn(`⚠️ Prepared session ${safeSession} ensemble not found or expired.`);
        }
      }

      res.render("custom-docking-form", {
        proteins,
        peptideLibrary,
        prepSession,
        preparedData,
        isPeptidePrep: false,
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).send("Internal Server Error");
    }
  }

  // UPDATED: Submit custom docking form - PDB or pre-prepared ensemble
  async submitCustomDocking(req, res) {
    const startTime = Date.now();
    console.log("🚀 CUSTOM PDB DOCKING STARTED");

    try {
      const { proteinId, inputType = "pdb" } = req.body;
      const prepSessionId = String(
        req.body.prepSessionId ||
        req.query.prepSession ||
        getCookieValue(req, PREP_SESSION_COOKIE) ||
        ""
      ).trim();

      // Input sanitization and validation
      if (!proteinId || typeof proteinId !== "string") {
        logSuspiciousActivity(
          req,
          "INVALID_PROTEIN_ID",
          `Received: ${proteinId}`
        );
        return res.status(400).json({ error: "Invalid protein ID" });
      }

      // UPDATED: Only accept "pdb" input type
      if (!inputType || inputType !== "pdb") {
        logSuspiciousActivity(
          req,
          "INVALID_INPUT_TYPE",
          `Received: ${inputType}`
        );
        return res
          .status(400)
          .json({ error: "Invalid input type. Only PDB files are supported." });
      }

      // Handle PDB source in priority order:
      // 1. Manually uploaded peptide file
      // 2. Selected prepared library peptide from dropdown
      // 3. Pre-prepared PyMOL ensemble from active session
      const rawPeptideUpload = (req.files && req.files["peptideFile"] && req.files["peptideFile"][0]) || req.file;
      let peptideUpload = (rawPeptideUpload && rawPeptideUpload.size > 0) ? rawPeptideUpload : null;
      const configUpload = (req.files && req.files["configFile"] && req.files["configFile"][0]) || null;

      const selectedLibraryFile = String(req.body.libraryFile || "").trim();
      if (!peptideUpload && selectedLibraryFile) {
        console.log(`🔍 Resolving selected library peptide file: ${selectedLibraryFile}`);
        const proteinForLibrary = await Protein.findById(proteinId);
        if (!proteinForLibrary) {
          return res.status(404).json({ error: "Protein not found" });
        }

        let libraryEntry;
        let libraryPath;
        if (selectedLibraryFile.startsWith("final-haddock/")) {
          const relativePath = selectedLibraryFile.slice("final-haddock/".length);
          const pathParts = relativePath.split("/");
          if (
            pathParts.length !== 2 ||
            !pathParts[0] ||
            !/^peptide_(ens|helix|ppii|sheet)\.pdb$/.test(pathParts[1])
          ) {
            return res.status(400).json({ error: "Invalid prepared peptide selection" });
          }
          libraryPath = path.resolve(FINAL_HADDOCK_PEPTIDE_ROOT, ...pathParts);
          if (!libraryPath.startsWith(`${FINAL_HADDOCK_PEPTIDE_ROOT}${path.sep}`)) {
            return res.status(400).json({ error: "Invalid prepared peptide selection" });
          }
          libraryEntry = {
            storedName: selectedLibraryFile,
            peptideName: pathParts[0],
            confType: pathParts[1].replace(/^peptide_|\.pdb$/g, ""),
          };
        } else {
          libraryEntry = proteinForLibrary?.peptideLibrary
            ?.flatMap((peptide) =>
              Object.entries(peptide.conformations || {}).map(([confType, storedName]) => ({
                storedName,
                peptideName: peptide.peptideName,
                confType,
              }))
            )
            .find((file) => file.storedName === selectedLibraryFile);
          libraryPath = libraryEntry
            ? path.join(__dirname, "../public/uploads", libraryEntry.storedName)
            : null;
        }

        if (!libraryEntry) {
          console.warn(`⚠️ Selected peptide ${selectedLibraryFile} not found in protein ${proteinForLibrary.name}`);
          return res.status(400).json({
            error: "Selected peptide structure is not available for the chosen protein",
          });
        }

        try {
          const stat = await fs.stat(libraryPath);
          peptideUpload = {
            originalname: `${libraryEntry.peptideName}_${libraryEntry.confType || "peptide"}.pdb`,
            filename: libraryEntry.storedName,
            path: libraryPath,
            size: stat.size,
            mimetype: "chemical/x-pdb",
            isLibraryFile: true,
          };
          console.log(`✅ Using prepared peptide library structure: ${libraryEntry.peptideName} (${libraryEntry.storedName})`);
        } catch (error) {
          console.error("❌ Selected peptide library file is unavailable:", error.message);
          return res.status(400).json({ error: "Selected peptide structure file is unavailable on server" });
        }
      }

      if (!peptideUpload && prepSessionId) {
        const safePrepId = String(prepSessionId).replace(/[^a-zA-Z0-9_-]/g, "");
        const prepEnsFile = path.join(__dirname, "../temp_results", safePrepId, "peptide_ens.pdb");
        try {
          await fs.access(prepEnsFile);
          const stat = await fs.stat(prepEnsFile);
          peptideUpload = {
            originalname: "peptide_ens.pdb",
            filename: "peptide_ens.pdb",
            path: prepEnsFile,
            size: stat.size,
            mimetype: "chemical/x-pdb",
            isPrepSession: true,
          };
          console.log(`✅ Using pre-prepared ensemble from session ${safePrepId}: ${prepEnsFile}`);
        } catch (prepErr) {
          console.warn(`Could not locate pre-prepared ensemble: ${prepErr.message}`);
        }
      }

      if (!peptideUpload) {
        return res.status(400).json({ error: "Please upload a peptide PDB file or select a prepared peptide from the dropdown." });
      }

      let finalPeptideSequence = "";
      let pdbFilePath = "";

      try {
        console.log(
          `📁 Processing uploaded PDB file: ${peptideUpload.originalname}`
        );
        console.log(`📁 File details:`, {
          originalname: peptideUpload.originalname,
          filename: peptideUpload.filename,
          path: peptideUpload.path,
          size: peptideUpload.size,
          mimetype: peptideUpload.mimetype,
        });

        // Validate PDB extension
        const originalExt = path.extname(peptideUpload.originalname).toLowerCase();
        console.log(`📋 Original file extension: ${originalExt}`);

        if (originalExt !== ".pdb") {
          throw new Error(
            `Invalid file extension: ${originalExt}. Only .pdb files are allowed for direct docking.`
          );
        }

        // Process PDB file (extracts sequence and keeps PDB file)
        const pdbResult = await processPDBFile(
          peptideUpload.path,
          peptideUpload.originalname,
          {
            minLength: 3,
            maxLength: 50,
            maxFileSize: 16 * 1024 * 1024, // 16MB max for PDB
          }
        );

        finalPeptideSequence = pdbResult.sequence;
        pdbFilePath = pdbResult.pdbFilePath;

        console.log(`✅ Valid PDB file processed: ${finalPeptideSequence}`);
        console.log(`✅ PDB file ready for direct docking: ${pdbFilePath}`);
      } catch (error) {
        console.log(`❌ PDB file processing error: ${error.message}`);
        logSuspiciousActivity(req, "MALICIOUS_PDB_FILE", error.message);
        return res.status(400).json({ error: error.message });
      }

      // Read custom config file if provided
      let customConfigContent = null;
      if (configUpload) {
        try {
          console.log(`⚙️ User uploaded custom config file: ${configUpload.originalname}`);
          customConfigContent = await fs.readFile(configUpload.path, "utf-8");
        } catch (cfgErr) {
          console.warn("Could not read custom config file:", cfgErr.message);
        }
      }

      // Extract engine and restraint inputs
      const engine = String(req.body.engine || "vina").toLowerCase();
      if (!["vina", "haddock3"].includes(engine)) {
        return res.status(400).json({ error: "Unsupported docking engine" });
      }
      console.log(`🧭 Docking engine selected by user: ${engine}`);
      const progressSessionId = String(req.body.progressSessionId || generateSessionId()).replace(/[^a-zA-Z0-9_-]/g, "");
      setDockingProgress(progressSessionId, { status: "queued", percent: 2, stage: "queue", detail: "Request received by the backend; waiting to start..." });
      const receptorActiveResidues = req.body.receptorActiveResidues ? req.body.receptorActiveResidues.trim() : null;
      const peptideActiveResidues = req.body.peptideActiveResidues ? req.body.peptideActiveResidues.trim() : null;

      // Validate protein exists and is accessible
      const protein = await Protein.findById(proteinId);
      if (!protein) {
        logSuspiciousActivity(req, "PROTEIN_NOT_FOUND", `ID: ${proteinId}`);
        return res.status(404).json({ error: "Protein not found" });
      }

      console.log(`✅ All validation passed. Starting direct docking...`);
      console.log(`   Protein: ${protein.name}`);
      console.log(`   Engine: ${engine.toUpperCase()}`);
      console.log(
        `   Sequence: ${finalPeptideSequence} (${finalPeptideSequence.length} aa)`
      );
      console.log(`   PDB File: ${pdbFilePath}`);

      // Perform direct docking with options
      const dockingResult = await performDirectPDBDocking(
        proteinId,
        pdbFilePath,
        finalPeptideSequence,
        {
          engine,
          progressSessionId,
          customConfigContent,
          receptorActiveResidues,
          peptideActiveResidues,
        }
      );

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      console.log(`✅ CUSTOM DIRECT DOCKING COMPLETED in ${duration}s`);

      // Clean up uploaded files (we've copied to session directory)
      try {
        if (peptideUpload && peptideUpload.path && !peptideUpload.isPrepSession && !peptideUpload.isLibraryFile) await fs.unlink(peptideUpload.path);
        if (configUpload && configUpload.path) await fs.unlink(configUpload.path);
      } catch (cleanupError) {
        console.warn("File cleanup warning:", cleanupError.message);
      }

      res.redirect(`/custom-docking-results/${dockingResult.sessionId}`);
    } catch (error) {
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      console.error(`❌ CUSTOM PDB DOCKING FAILED after ${duration}s:`, error);

      // Clean up uploaded file on error
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (cleanupError) {
          console.warn("File cleanup warning:", cleanupError.message);
        }
      }

      // Don't expose internal errors to client
      const safeError =
        process.env.NODE_ENV !== "production" ||
        error.message.includes("validation") ||
        error.message.includes("Invalid")
          ? error.message
          : "Internal server error during PDB docking process";

      res.status(500).json({ error: safeError });
    }
  }

  // UPDATED: Get custom docking results with HLA config info
  async getCustomDockingResults(req, res) {
    try {
      const { sessionId } = req.params;
      console.log(
        `📊 Loading custom docking results for session: ${sessionId}`
      );

      // Load the custom docking result from temporary storage
      const resultPath = path.join(
        __dirname,
        "../temp_results",
        `${sessionId}.json`
      );

      if (!(await fileService.fileExists(resultPath))) {
        console.log(`❌ Result file not found: ${resultPath}`);
        return res.status(404).send("Docking result not found or expired");
      }

      const dockingData = JSON.parse(await fs.readFile(resultPath, "utf-8"));
      console.log(`✅ Loaded docking data for session: ${sessionId}`);

      // NEW: Log direct PDB docking info with HLA config
      if (dockingData.directPDBDocking) {
        console.log(`✅ Direct PDB docking session detected`);
        console.log(`   - Modeling skipped: ${dockingData.modelingSkipped}`);
        console.log(`   - Method: ${dockingData.dockingMethod}`);
        console.log(
          `   - Dynamic HLA config: ${dockingData.dynamicHLAConfiguration}`
        );

        if (dockingData.hlaConfig) {
          console.log(`   - HLA Configuration:`);
          console.log(
            `     - Protein Dir: ${dockingData.hlaConfig.proteinDir}`
          );
          console.log(
            `     - Grid Center: (${dockingData.hlaConfig.center_x}, ${dockingData.hlaConfig.center_y}, ${dockingData.hlaConfig.center_z})`
          );
          console.log(
            `     - Grid Size: ${dockingData.hlaConfig.size_x}×${dockingData.hlaConfig.size_y}×${dockingData.hlaConfig.size_z}`
          );
        }
      }

      // Check for warnings and add them to console
      if (dockingData.warnings && dockingData.warnings.length > 0) {
        console.log("⚠️ DOCKING WARNINGS:");
        dockingData.warnings.forEach((warning) =>
          console.log(`   - ${warning}`)
        );
      }

      // Enhanced file verification with membrane checking
      const sessionDir = path.join(__dirname, "../temp_results", sessionId);
      console.log(`🔍 Verifying files for session: ${sessionId}`);
      console.log(`Session directory: ${sessionDir}`);

      // Check if session directory exists
      if (!(await fileService.fileExists(sessionDir))) {
        console.error(`❌ Session directory not found: ${sessionDir}`);
        return res.status(404).send("Session files not found");
      }

      // Enhanced debug information with membrane verification
      await debugSessionFiles(sessionDir);

      // Verify all required files exist
      const requiredFiles = ["complex.pdb"];
      if (await fileService.fileExists(path.join(sessionDir, "protein_clean.pdb"))) {
        requiredFiles.push("protein_clean.pdb");
      } else if (await fileService.fileExists(path.join(sessionDir, "receptor.pdb"))) {
        requiredFiles.push("receptor.pdb");
      }

      for (const filename of requiredFiles) {
        const filePath = path.join(sessionDir, filename);
        if (!(await fileService.fileExists(filePath))) {
          console.error(`❌ Required file not found: ${filename}`);
          return res.status(500).send(`Missing required file: ${filename}`);
        } else {
          const stats = await fs.stat(filePath);
          console.log(`✅ ${filename}: ${stats.size} bytes`);
        }
      }

      // Verify protein file exists in uploads directory
      const proteinPath = path.join(
        __dirname,
        "../public/uploads",
        dockingData.protein.mainProteinFile
      );
      if (!(await fileService.fileExists(proteinPath))) {
        console.error(`❌ Original protein file not found: ${proteinPath}`);
      } else {
        const stats = await fs.stat(proteinPath);
        console.log(`✅ Original protein file: ${stats.size} bytes`);
      }

      // Check if session is near expiry
      if (dockingData.expiresAt) {
        const expiryTime = new Date(dockingData.expiresAt);
        const timeLeft = expiryTime.getTime() - Date.now();
        const hoursLeft = Math.round(timeLeft / (60 * 60 * 1000));

        if (hoursLeft < 6) {
          console.warn(`⚠️ Session expires in ${hoursLeft} hours`);
          if (!dockingData.warnings) dockingData.warnings = [];
          dockingData.warnings.push(`Session expires in ${hoursLeft} hours`);
        }
      }

      // Enhanced verification logging with HLA config info
      console.log(`✅ Direct PDB docking verification:`);
      console.log(`   - Direct PDB docking: ${dockingData.directPDBDocking}`);
      console.log(`   - Modeling skipped: ${dockingData.modelingSkipped}`);
      console.log(`   - Membranes removed: ${dockingData.membranesRemoved}`);
      console.log(
        `   - Cleaning method: ${dockingData.membraneCleaningMethod}`
      );
      console.log(`   - Docking method: ${dockingData.dockingMethod}`);
      console.log(
        `   - Dynamic HLA config: ${dockingData.dynamicHLAConfiguration}`
      );
      console.log(
        `   - Auto-cleanup scheduled: ${dockingData.autoCleanupScheduled}`
      );

      // Use the unified docking-results.ejs with custom data
      res.render("docking-results", {
        dockingData, // For custom docking
        sessionId,
        includeMolstar: true,
        // Debug information
        debugInfo: {
          sessionExists: true,
          filesVerified: true,
          directPDBDocking: dockingData.directPDBDocking,
          modelingSkipped: dockingData.modelingSkipped,
          membranesRemoved: dockingData.membranesRemoved,
          membraneCleaningMethod: dockingData.membraneCleaningMethod,
          dockingMethod: dockingData.dockingMethod,
          actualDocking: dockingData.actualDocking,
          dynamicHLAConfiguration: dockingData.dynamicHLAConfiguration,
          hlaConfigInfo: dockingData.hlaConfig,
          autoCleanupScheduled: dockingData.autoCleanupScheduled,
          expiresAt: dockingData.expiresAt,
          timestamp: new Date().toISOString(),
        },
        // Set these to undefined for custom docking
        protein: undefined,
        dockingResult: undefined,
        proteinPdb: undefined,
        peptidePdb: undefined,
        complexPdb: undefined,
        peptideName: undefined,
      });
    } catch (error) {
      console.error("❌ Error loading custom docking results:", error);
      res.status(500).send("Error loading docking results");
    }
  }

  async getDockingProgress(req, res) {
    const { sessionId } = req.params;
    const progress = dockingProgress.get(sessionId);
    if (!progress) {
      return res.status(404).json({ error: "Docking session not found" });
    }

    let logTail = "";
    try {
      const logPath = path.join(__dirname, "../temp_results", sessionId, "haddock.log");
      const log = await fs.readFile(logPath, "utf8");
      logTail = log.split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
    } catch (_) {}

    res.json({ ...progress, logTail });
  }

  // All other methods remain unchanged
  async serveTempFile(req, res) {
    try {
      const { sessionId, filename } = req.params;
      console.log(`📁 Serving temp file: ${sessionId}/${filename}`);

      // Validate session ID format
      if (!/^session_\d+_[a-z0-9]+$/.test(sessionId) && !/^prep_\d+_[a-z0-9]+$/.test(sessionId) && !/^progress_\d+_[a-z0-9]+$/.test(sessionId)) {
        console.log(`❌ Invalid session ID format: ${sessionId}`);
        return res.status(400).send("Invalid session ID");
      }

      // Validate filename format and whitelist allowed extensions
      const allowedExtensions = [".pdb", ".log", ".conf", ".txt", ".tbl", ".cfg", ".json"];
      const fileExtension = path.extname(filename).toLowerCase();

      if (!allowedExtensions.includes(fileExtension)) {
        console.log(`❌ File type not allowed: ${filename}`);
        return res.status(403).send("File type not allowed");
      }

      // Prevent directory traversal attacks
      if (
        filename.includes("..") ||
        filename.includes("/") ||
        filename.includes("\\")
      ) {
        console.log(`❌ Suspicious filename: ${filename}`);
        return res.status(403).send("Invalid filename");
      }

      const filePath = path.join(
        __dirname,
        "../temp_results",
        sessionId,
        filename
      );

      if (!(await fileService.fileExists(filePath))) {
        console.log(`❌ Temp file not found: ${filePath}`);
        return res.status(404).send("File not found");
      }

      // Enhanced verification for PDB files
      if (fileExtension === ".pdb") {
        const content = await fs.readFile(filePath, "utf-8");
        const membraneResidues = [
          "POPC",
          "POPE",
          "DPPC",
          "CHOL",
          "DMPC",
          "DOPC",
          "HOH",
          "WAT",
        ];
        const foundMembrane = membraneResidues.filter((res) =>
          content.includes(res)
        );

        if (foundMembrane.length > 0) {
          console.warn(
            `⚠️ WARNING: PDB file ${filename} contains membrane residues: ${foundMembrane.join(
              ", "
            )}`
          );
        } else {
          console.log(`✅ VERIFIED: PDB file ${filename} is membrane-free`);
        }
      }

      // Set appropriate content type
      const contentTypeMap = {
        ".pdb": "chemical/x-pdb",
        ".log": "text/plain",
        ".conf": "text/plain",
        ".txt": "text/plain",
      };

      const contentType =
        contentTypeMap[fileExtension] || "application/octet-stream";

      // Add security headers
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Cache-Control",
        "private, no-cache, no-store, must-revalidate"
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      console.log(`✅ Serving file: ${filename} (${contentType})`);
      res.sendFile(path.resolve(filePath));
    } catch (error) {
      console.error("❌ Error serving temp file:", error);
      res.status(500).send("Error serving file");
    }
  }

  // Get auto-cleanup status
  async getAutoCleanupStatus(req, res) {
    try {
      const status = fileService.getCleanupStatus();
      const sessions = await fileService.listTempSessions();

      const stats = {
        autoCleanup: status,
        sessionCount: sessions.length,
        sessionsNearExpiry: sessions.filter((s) => s.ageHours >= 20).length,
        oldestSessionAge:
          sessions.length > 0
            ? Math.max(...sessions.map((s) => s.ageHours))
            : 0,
        totalStorageUsed: sessions.reduce((sum, s) => sum + s.size, 0),
      };

      res.json(stats);
    } catch (error) {
      console.error("❌ Error getting cleanup status:", error);
      res.status(500).json({ error: "Failed to get cleanup status" });
    }
  }

  // Force cleanup now (for admin use)
  async forceCleanupNow(req, res) {
    try {
      console.log("🚀 Manual cleanup trigger requested...");
      const result = await fileService.forceCleanupNow();

      res.json({
        message: "Manual cleanup completed",
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Error during manual cleanup:", error);
      res
        .status(500)
        .json({ error: "Manual cleanup failed", message: error.message });
    }
  }

  // UPDATED: Get session statistics with auto-cleanup info and HLA config tracking
  async getSessionStats(req, res) {
    try {
      const sessions = await fileService.listTempSessions();
      const cleanupStatus = fileService.getCleanupStatus();

      const stats = {
        totalSessions: sessions.length,
        realDockingCount: 0,
        simulationCount: 0,
        directPDBCount: 0,
        dynamicHLAConfigCount: 0, // NEW: Count dynamic HLA config sessions
        membraneCleanSessions: 0,
        membraneIssueSessions: 0,
        sessionsNearExpiry: 0,
        averageAge: 0,
        oldestSession: null,
        newestSession: null,
        autoCleanupStatus: cleanupStatus,
        totalStorageBytes: 0,
        hlaConfigBreakdown: {}, // NEW: Breakdown by HLA protein type
      };

      if (sessions.length > 0) {
        let totalAge = 0;
        let oldest = sessions[0];
        let newest = sessions[0];

        for (const session of sessions) {
          const age = Date.now() - session.modified.getTime();
          totalAge += age;
          stats.totalStorageBytes += session.size;

          if (session.modified < oldest.modified) oldest = session;
          if (session.modified > newest.modified) newest = session;

          // Check if session is near expiry (>20 hours old)
          if (session.ageHours >= 20) {
            stats.sessionsNearExpiry++;
          }

          // Try to read session data to get method and membrane status
          try {
            const resultPath = path.join(
              __dirname,
              "../temp_results",
              `${session.sessionId}.json`
            );
            const sessionData = JSON.parse(
              await fs.readFile(resultPath, "utf-8")
            );

            if (sessionData.actualDocking) {
              stats.realDockingCount++;
            } else {
              stats.simulationCount++;
            }

            // Count direct PDB docking sessions
            if (sessionData.directPDBDocking) {
              stats.directPDBCount++;
            }

            // NEW: Count dynamic HLA configuration sessions
            if (sessionData.dynamicHLAConfiguration) {
              stats.dynamicHLAConfigCount++;

              // Track HLA config breakdown
              if (sessionData.hlaConfig && sessionData.hlaConfig.proteinDir) {
                const proteinDir = sessionData.hlaConfig.proteinDir;
                stats.hlaConfigBreakdown[proteinDir] =
                  (stats.hlaConfigBreakdown[proteinDir] || 0) + 1;
              }
            }

            // Check membrane removal status
            if (sessionData.membranesRemoved) {
              stats.membraneCleanSessions++;
            }

            // Verify complex file for membrane residues
            const sessionDir = path.join(
              __dirname,
              "../temp_results",
              session.sessionId
            );
            const complexPath = path.join(sessionDir, "complex.pdb");
            if (await fileService.fileExists(complexPath)) {
              const content = await fs.readFile(complexPath, "utf-8");
              const membraneResidues = ["POPC", "POPE", "DPPC", "CHOL"];
              const foundMembrane = membraneResidues.some((res) =>
                content.includes(res)
              );
              if (foundMembrane) {
                stats.membraneIssueSessions++;
              }
            }
          } catch (error) {
            // Ignore errors reading individual sessions
          }
        }

        stats.averageAge = Math.round(
          totalAge / sessions.length / (60 * 60 * 1000)
        ); // hours
        stats.oldestSession = {
          sessionId: oldest.sessionId,
          age: Math.round(
            (Date.now() - oldest.modified.getTime()) / (60 * 60 * 1000)
          ),
        };
        stats.newestSession = {
          sessionId: newest.sessionId,
          age: Math.round(
            (Date.now() - newest.modified.getTime()) / (60 * 60 * 1000)
          ),
        };
      }

      res.json(stats);
    } catch (error) {
      console.error("❌ Error getting session stats:", error);
      res.status(500).json({ error: "Failed to get session statistics" });
    }
  }

  // Debug session method
  async debugSession(req, res) {
    try {
      const { sessionId } = req.params;
      console.log(`🔍 DEBUGGING SESSION: ${sessionId}`);

      const sessionDir = path.join(__dirname, "../temp_results", sessionId);
      const files = ["complex.pdb", "protein_clean.pdb"];

      const results = {};

      for (const filename of files) {
        const filePath = path.join(sessionDir, filename);
        console.log(`\n🔍 ANALYZING: ${filename}`);
        results[filename] = await dockingService.debugMembraneInFile(filePath);
      }

      // NEW: Also check for HLA configuration info
      try {
        const resultPath = path.join(
          __dirname,
          "../temp_results",
          `${sessionId}.json`
        );
        if (await fileService.fileExists(resultPath)) {
          const sessionData = JSON.parse(
            await fs.readFile(resultPath, "utf-8")
          );
          results.sessionInfo = {
            dynamicHLAConfig: sessionData.dynamicHLAConfiguration,
            hlaConfig: sessionData.hlaConfig,
            dockingMethod: sessionData.dockingMethod,
            directPDBDocking: sessionData.directPDBDocking,
          };
          console.log(`\n🔍 SESSION INFO:`);
          console.log(
            `   - Dynamic HLA Config: ${sessionData.dynamicHLAConfiguration}`
          );
          if (sessionData.hlaConfig) {
            console.log(
              `   - HLA Protein Dir: ${sessionData.hlaConfig.proteinDir}`
            );
            console.log(
              `   - Grid Center: (${sessionData.hlaConfig.center_x}, ${sessionData.hlaConfig.center_y}, ${sessionData.hlaConfig.center_z})`
            );
          }
        }
      } catch (error) {
        results.sessionInfoError = error.message;
      }

      res.json({
        message: "Debug analysis complete - check console logs",
        sessionId,
        results,
      });
    } catch (error) {
      console.error("❌ Debug session error:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // NEW: Get HLA configuration status endpoint
  async getHLAConfigStatus(req, res) {
    try {
      console.log("🔍 Checking HLA configuration status...");

      // Validate HLA data structure
      const validationResult = await dockingService.validateHLADataStructure();

      // Get all available configurations
      let availableConfigs = [];
      try {
        availableConfigs = await dockingService.getAllHLAConfigurations();
      } catch (configError) {
        console.warn("Warning getting HLA configs:", configError.message);
      }

      const status = {
        hlaDataPathExists: validationResult.basePathExists,
        totalExpectedConfigs: 8, // HLA-DQ2.2 through HLA-DQ9
        availableConfigs: availableConfigs.length,
        validConfigurations: validationResult.validConfigurations || [],
        invalidConfigurations: validationResult.invalidConfigurations || [],
        foundDirectories: validationResult.foundDirectories || [],
        missingDirectories: validationResult.missingDirectories || [],
        configurationDetails: availableConfigs.map((config) => ({
          name: config.name,
          centerCoords: `(${config.config.center_x}, ${config.config.center_y}, ${config.config.center_z})`,
          gridSize: `${config.config.size_x}×${config.config.size_y}×${config.config.size_z}`,
          threadCount: config.config.thread,
          searchDepth: config.config.search_depth,
          numModes: config.config.num_modes,
        })),
        systemStatus: validationResult.error ? "ERROR" : "OK",
        error: validationResult.error,
        timestamp: new Date().toISOString(),
      };

      res.json(status);
    } catch (error) {
      console.error("❌ Error getting HLA config status:", error);
      res.status(500).json({
        error: "Failed to get HLA configuration status",
        message: error.message,
      });
    }
  }
}

module.exports = new CustomDockingController();
