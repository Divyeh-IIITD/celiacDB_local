// Docking Results JavaScript
// Author: HLA-DQ Protein Analysis Platform
// Description: Handles 3D visualization and interactions for docking results

// Global variables for Mol* viewers
let molstarViewers = {};
const config = window.dockingConfig || {};
const isCustomDocking = config.isCustomDocking || false;
const actualDocking = config.actualDocking || true;

console.log("🚀 Docking Results JavaScript Loaded and cleared any old cache");
console.log("Configuration:", config);

/**
 * Convert UTF-8 string to base64 (handles non-Latin1 characters)
 * @param {string} str - String to encode
 * @returns {string} Base64 encoded string
 */
function utf8ToBase64(str) {
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < utf8Bytes.byteLength; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return btoa(binary);
}

// Cleanup function for page navigation
function cleanupViewers() {
  console.log("🧹 Cleaning up Mol* viewers...");

  // Destroy all Mol* viewer instances
  Object.keys(molstarViewers).forEach((containerId) => {
    try {
      const viewer = molstarViewers[containerId];
      if (viewer && typeof viewer.clear === "function") {
        viewer.clear();
      }
      delete molstarViewers[containerId];
    } catch (error) {
      console.warn(
        `Warning: Could not cleanup viewer ${containerId}:`,
        error.message
      );
    }
  });

  // Clear all viewer containers
  const containers = document.querySelectorAll(".molstar-container");
  containers.forEach((container) => {
    container.innerHTML = '<div class="loading">Loading...</div>';
  });

  molstarViewers = {};
}

// Handle page visibility changes and navigation
document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    console.log("🔄 Page hidden - preparing for cleanup");
  }
});

// Handle beforeunload for cleanup
window.addEventListener("beforeunload", function () {
  cleanupViewers();
});

// Handle page show/hide for back navigation
window.addEventListener("pageshow", function (event) {
  if (event.persisted) {
    console.log("🔄 Page restored from cache - reinitializing...");
    // Reinitialize viewers if page was cached
    setTimeout(() => {
      initializeMolstarViewers();
    }, 1000);
  }
});

window.addEventListener("pagehide", function () {
  console.log("🔄 Page hiding - cleaning up...");
  cleanupViewers();
});

// Initialize all viewers when page loads
document.addEventListener("DOMContentLoaded", function () {
  console.log("🚀 Initializing docking results page...");
  console.log("Custom docking:", isCustomDocking);
  console.log("Actual docking performed:", actualDocking);

  // Load all 3D structures with Mol*
  initializeMolstarViewers();

  // Load scores and config for pre-computed results
  if (!isCustomDocking) {
    loadDockingScores();
    loadConfiguration();
  }

  // Hide Mol* expand buttons after a delay
  setTimeout(() => {
    hideMolstarExpandButtons();
    setupExpandButtonMonitoring();
  }, 3000);
});

/**
 * Initialize all Mol* viewers
 */
function initializeMolstarViewers() {
  console.log("🔬 Initializing Mol* viewers...");

  if (isCustomDocking) {
    // Custom docking files
    if (config.proteinFile) {
      console.log("Loading HLA-DQ protein with Mol*...");
      loadMolstarProtein("proteinViewer", config.proteinFile);
    }

    if (config.peptideFile) {
      console.log("Loading custom peptide with Mol*...");
      loadMolstarPeptide("peptideViewer", config.peptideFile);
    }

    if (config.complexFile) {
      console.log("Loading docked complex with Mol*...");
      loadMolstarComplex(
        "complexViewer",
        config.complexFile,
        config.peptideSequence
      );
    }
  } else {
    // Pre-computed docking files
    if (config.proteinFile) {
      console.log("Loading HLA-DQ protein with Mol*...");
      loadMolstarProtein("proteinViewer", config.proteinFile);
    }

    if (config.peptideFile) {
      console.log("Loading peptide with Mol*...");
      loadMolstarPeptide("peptideViewer", config.peptideFile);
    }

    if (config.complexFile) {
      console.log("Loading complex with Mol*...");
      loadMolstarComplex(
        "complexViewer",
        config.complexFile,
        config.peptideSequence
      );
    }
  }
}

/**
 * Load protein structure with Mol*
 * @param {string} containerId - ID of the container element
 * @param {string} pdbUrl - URL to the PDB file
 */
function loadMolstarProtein(containerId, pdbUrl) {
  console.log(`🔍 Attempting to load protein from: ${pdbUrl}`);

  // First check if file exists
  fetch(pdbUrl, { method: "HEAD" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`File not found: ${response.status} - ${pdbUrl}`);
      }
      console.log(`✅ Protein file exists: ${pdbUrl}`);

      const options = {
        customData: {
          url: pdbUrl,
          format: "pdb",
          binary: false,
        },
        alphafoldView: false,
        bgColor: { r: 255, g: 255, b: 255 },
        hideControls: false,
        hideCanvasControls: ["expand", "fullscreen"],
        sequencePanel: true,
        pdbeUrl: pdbUrl,
        loadMaps: false,
        validationAnnotation: false,
        domainAnnotation: false,
        lowPrecisionCoords: true,
        selectInteraction: true,
        lighting: "matte",
        defaultPreset: "default",
      };

      const viewerInstance = new PDBeMolstarPlugin();

      viewerInstance
        .render(containerId, options)
        .then(() => {
          console.log("✅ Mol* protein viewer loaded successfully");
          molstarViewers[containerId] = viewerInstance;
          setTimeout(() => hideMolstarExpandButtons(), 1000);
        })
        .catch((renderError) => {
          console.error("❌ Error rendering protein viewer:", renderError);
          showViewerError(
            containerId,
            "protein structure",
            pdbUrl,
            renderError.message
          );
        });
    })
    .catch((error) => {
      console.error("❌ Error loading protein:", error);
      showViewerError(containerId, "protein structure", pdbUrl, error.message);
    });
}

/**
 * Load peptide structure with Mol*
 * @param {string} containerId - ID of the container element
 * @param {string} pdbUrl - URL to the PDB file
 */
async function loadMolstarPeptide(containerId, pdbUrl) {
  console.log(`🔍 Attempting to load peptide from: ${pdbUrl}`);

  try {
    // Fetch full PDB text (instead of just HEAD)
    const response = await fetch(pdbUrl);
    if (!response.ok)
      throw new Error(`File not found: ${response.status} - ${pdbUrl}`);
    let pdbText = await response.text();

    // 🔧 Normalize chain IDs
    let chainId = "A".charCodeAt(0) - 1; // start before A
    let seenTER = false;
    let fixedPdb = "";

    pdbText.split("\n").forEach((line) => {
      if (line.startsWith("TER")) {
        seenTER = true;
        fixedPdb += line + "\n";
      } else if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        let arr = line.split("");
        if (!seenTER) {
          // first block → ensure at least chain A
          if (arr[21] === " " || !/[A-Za-z0-9]/.test(arr[21])) {
            chainId++;
            arr[21] = String.fromCharCode(chainId);
          }
        } else {
          // subsequent blocks → increment chain
          if (arr[21] === " " || !/[A-Za-z0-9]/.test(arr[21])) {
            chainId++;
            arr[21] = String.fromCharCode(chainId);
          }
        }
        fixedPdb += arr.join("") + "\n";
      } else {
        fixedPdb += line + "\n";
      }
    });

    // Viewer options
    const options = {
      customData: {
        url: "data:text/plain;base64," + utf8ToBase64(fixedPdb),
        format: "pdb",
        binary: false,
      },
      alphafoldView: false,
      bgColor: { r: 255, g: 255, b: 255 },
      hideControls: false,
      hideCanvasControls: ["expand", "fullscreen"],
      sequencePanel: true,
      loadMaps: false,
      validationAnnotation: false,
      domainAnnotation: false,
      lowPrecisionCoords: true,
      selectInteraction: true,
      lighting: "matte",
      defaultPreset: "default",
    };

    const viewerInstance = new PDBeMolstarPlugin();
    await viewerInstance.render(containerId, options);

    console.log("✅ Mol* peptide viewer loaded successfully");
    molstarViewers[containerId] = viewerInstance;

    setTimeout(() => hideMolstarExpandButtons(), 1000);
  } catch (error) {
    console.error("❌ Error loading peptide:", error);
    showViewerError(containerId, "peptide structure", pdbUrl, error.message);
  }
}

/**
 * Load complex structure with Mol*
 * @param {string} containerId - ID of the container element
 * @param {string} pdbUrl - URL to the PDB file
 * @param {string} peptideSequence - Peptide sequence
 */
async function loadMolstarComplex(containerId, pdbUrl, peptideSequence) {
  console.log(`🔍 Attempting to load complex from: ${pdbUrl}`);

  try {
    // Fetch full PDB content (not HEAD this time)
    const response = await fetch(pdbUrl);
    if (!response.ok) throw new Error(`File not found: ${pdbUrl}`);
    let pdbText = await response.text();

    // Preserve HADDOCK chain IDs and only assign missing IDs across TER-separated chains.
    let fixedPdb = "";
    let chainCode = 65; // ASCII for 'A'
    let currentChain = String.fromCharCode(chainCode);

    pdbText.split("\n").forEach((line) => {
      if (line.startsWith("TER")) {
        fixedPdb += line + "\n";
        chainCode++;
        currentChain = String.fromCharCode(chainCode); // Next chain
      } else if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        let arr = line.split("");

        if (arr[21] === " " || !/[A-Za-z0-9]/.test(arr[21])) {
          arr[21] = currentChain;
        }

        fixedPdb += arr.join("") + "\n";
      } else {
        fixedPdb += line + "\n";
      }
    });

    // Render using Mol*
    const options = {
      customData: {
        url: "data:text/plain;base64," + utf8ToBase64(fixedPdb),
        format: "pdb",
        binary: false,
      },
      bgColor: { r: 128, g: 128, b: 128 },
      hideControls: false,
      hideCanvasControls: ["expand", "fullscreen"],
      sequencePanel: true,
      loadMaps: false,
      showAllModels: true,
    };

    const viewerInstance = new PDBeMolstarPlugin();

    const emphasizePeptide = () => {
      if (!viewerInstance.visual) return;
      try {
        viewerInstance.visual.clearSelection?.();
        viewerInstance.visual.clearHighlight?.();
        viewerInstance.visual.sequenceColor({
          data: [
            { label_asym_id: "A", color: "#22a447" },
            { label_asym_id: "B", color: "#e53935" },
          ],
          keepColors: false,
        });
        console.log("✅ Complex colored: chain A green, peptide chain B red");
      } catch (selectionError) {
        console.warn("Could not emphasize peptide chain B:", selectionError.message);
      }
    };

    if (viewerInstance.events && viewerInstance.events.loadComplete) {
      viewerInstance.events.loadComplete.subscribe(emphasizePeptide);
    }

    await viewerInstance.render(containerId, options);
    console.log("✅ Mol* complex viewer loaded successfully");
    molstarViewers[containerId] = viewerInstance;

    // Keep a delayed retry for CDN/plugin versions that resolve render() before loadComplete.
    setTimeout(emphasizePeptide, 1200);

    setTimeout(() => {
      hideMolstarExpandButtons();
    }, 2000);
  } catch (error) {
    console.error("❌ Error loading complex:", error);
    showViewerError(containerId, "complex structure", pdbUrl, error.message);
  }
}

/**
 * Show error message in viewer container
 * @param {string} containerId - ID of the container element
 * @param {string} structureType - Type of structure (protein, peptide, complex)
 * @param {string} url - URL that failed to load
 * @param {string} errorMessage - Error message
 */
function showViewerError(containerId, structureType, url, errorMessage) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `
      <div class="error-message">
        ❌ Failed to render ${structureType}<br>
        <small>URL: ${url}</small><br>
        <small>Error: ${errorMessage}</small>
      </div>`;
  }
}

/**
 * Hide ONLY Mol* built-in expand/fullscreen buttons
 */
function hideMolstarExpandButtons() {
  try {
    const molstarContainers = document.querySelectorAll(".molstar-container");

    molstarContainers.forEach((container) => {
      const expandButtonSelectors = [
        ".msp-btn-expand",
        ".msp-btn-fullscreen",
        'button[title*="fullscreen"]',
        'button[title*="Fullscreen"]',
        'button[title*="expand"]',
        'button[title*="Expand"]',
      ];

      expandButtonSelectors.forEach((selector) => {
        const buttons = container.querySelectorAll(selector);
        buttons.forEach((button) => {
          const title = button.getAttribute("title") || "";
          const textContent = button.textContent || "";

          if (
            title.toLowerCase().includes("expand") ||
            title.toLowerCase().includes("fullscreen") ||
            textContent.toLowerCase().includes("expand") ||
            textContent.toLowerCase().includes("fullscreen")
          ) {
            button.style.display = "none !important";
            button.style.visibility = "hidden !important";
            button.disabled = true;
            button.onclick = null;
          }
        });
      });
    });

    console.log("✅ Mol* expand buttons hidden");
  } catch (error) {
    console.error("❌ Error hiding Mol* expand buttons:", error);
  }
}

/**
 * Setup expand button monitoring for dynamically added buttons
 */
function setupExpandButtonMonitoring() {
  const viewersSection = document.querySelector(".viewers-section");
  if (!viewersSection) return;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          const expandButtons = node.querySelectorAll
            ? node.querySelectorAll(
                'button[title*="expand"], button[title*="fullscreen"], .msp-btn-expand, .msp-btn-fullscreen'
              )
            : [];

          if (expandButtons.length > 0) {
            hideMolstarExpandButtons();
          }
        }
      });
    });
  });

  observer.observe(viewersSection, {
    childList: true,
    subtree: true,
  });
}

/**
 * Load docking scores (for pre-computed results)
 */
function loadDockingScores() {
  console.log("📊 Loading docking scores...");

  if (config.logContent) {
    // Direct log content available
    parseDockingScore(config.logContent);
  } else if (config.logFile) {
    // Load from file
    fetch(config.logFile)
      .then((response) => response.text())
      .then((logText) => parseDockingScore(logText))
      .catch((error) => {
        console.error("Error loading log:", error);
        showScoreError("Failed to load docking scores");
      });
  } else {
    showScoreError("No docking log available");
  }
}

/**
 * Parse docking score from log content
 * @param {string} logText - Log file content
 */
function parseDockingScore(logText) {
  try {
    const lines = logText.split("\n");
    let foundTable = false;
    let bestScore = null;

    for (let line of lines) {
      line = line.trim();

      if (line.includes("mode") && line.includes("affinity")) {
        foundTable = true;
        continue;
      }

      if (foundTable && line.match(/^\s*1\s/)) {
        const parts = line.split(/\s+/).filter((p) => p.length > 0);
        if (parts.length >= 4) {
          bestScore = {
            mode: parseInt(parts[0]),
            affinity: parseFloat(parts[1]),
            rmsdLb: parseFloat(parts[2]),
            rmsdUb: parseFloat(parts[3]),
          };
          break;
        }
      }
    }

    if (bestScore) {
      displayScore(bestScore);
    } else {
      showScoreError("Could not parse docking scores");
    }
  } catch (error) {
    console.error("Score parsing error:", error);
    showScoreError("Error parsing scores");
  }
}

/**
 * Display docking score in the UI
 * @param {Object} score - Score object with affinity, mode, rmsd values
 */
function displayScore(score) {
  const scoreDisplay = document.getElementById("scoreDisplay");
  if (scoreDisplay) {
    scoreDisplay.innerHTML = `
      <div class="score-card real-docking">
        <div class="score-main">
          <span class="score-value">${score.affinity}</span>
          <span class="score-unit">kcal/mol</span>
        </div>
        <div class="score-details">
          <div class="score-item">
            <span class="label">Mode:</span>
            <span class="value">${score.mode}</span>
          </div>
          <div class="score-item">
            <span class="label">RMSD Range:</span>
            <span class="value">${score.rmsdLb.toFixed(
              3
            )} - ${score.rmsdUb.toFixed(3)} Å</span>
          </div>
        </div>
        <div class="score-note">
          Lower (more negative) values indicate stronger binding affinity.
        </div>
      </div>
    `;
  }
}

/**
 * Show score error message
 * @param {string} message - Error message
 */
function showScoreError(message) {
  const scoreDisplay = document.getElementById("scoreDisplay");
  if (scoreDisplay) {
    scoreDisplay.innerHTML = `<div class="error-message">${message}</div>`;
  }
}

/**
 * Load configuration (for pre-computed results)
 */
function loadConfiguration() {
  console.log("⚙️ Loading configuration...");

  if (config.configFile) {
    fetch(config.configFile)
      .then((response) => response.text())
      .then((configText) => parseAndDisplayConfig(configText))
      .catch((error) => {
        console.error("Error loading config:", error);
        showConfigError("Failed to load configuration");
      });
  } else {
    showConfigError("No configuration file available");
  }
}

/**
 * Parse and display configuration
 * @param {string} configText - Configuration file content
 */
function parseAndDisplayConfig(configText) {
  const lines = configText.split("\n");
  let configHtml = '<div class="config-display"><div class="config-grid">';

  lines.forEach((line) => {
    line = line.trim();
    if (line && !line.startsWith("#")) {
      const [key, value] = line.split("=").map((s) => s.trim());
      if (key && value) {
        const displayKey = key
          .replace(/_/g, " ")
          .replace(/\b\w/g, (l) => l.toUpperCase());
        configHtml += `
          <div class="config-item">
            <span class="config-key">${displayKey}</span>
            <span class="config-value">${value}</span>
          </div>
        `;
      }
    }
  });

  configHtml += "</div></div>";

  const configDisplay = document.getElementById("configDisplay");
  if (configDisplay) {
    configDisplay.innerHTML = configHtml;
  }
}

/**
 * Show configuration error message
 * @param {string} message - Error message
 */
function showConfigError(message) {
  const configDisplay = document.getElementById("configDisplay");
  if (configDisplay) {
    configDisplay.innerHTML = `<div class="error-message">${message}</div>`;
  }
}

/**
 * Toggle log details visibility (for custom docking)
 */
function toggleLogDetails() {
  const logContent = document.getElementById("logContent");
  const toggleText = document.getElementById("logToggleText");

  if (logContent && toggleText) {
    if (logContent.style.display === "none") {
      logContent.style.display = "block";
      toggleText.textContent = "Hide Full Log";
    } else {
      logContent.style.display = "none";
      toggleText.textContent = "Show Full Log";
    }
  }
}

/**
 * Download log file (for custom docking)
 */
function downloadLog() {
  if (config.logContent) {
    const logContent = config.logContent;
    const blob = new Blob([logContent], { type: "text/plain" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "custom_docking.log";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } else {
    console.error("No log content available for download");
  }
}

/**
 * Download configuration file (for custom docking)
 */
function downloadConfig() {
  if (config.configContent) {
    const configContent = config.configContent;
    const blob = new Blob([configContent], { type: "text/plain" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = "docking_config.conf";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } else {
    console.error("No config content available for download");
  }
}

/**
 * Utility function to create download link
 * @param {string} content - File content
 * @param {string} filename - Download filename
 * @param {string} mimeType - MIME type
 */
function createDownloadLink(content, filename, mimeType = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * Initialize tooltips (if Bootstrap is available)
 */
function initializeTooltips() {
  if (typeof bootstrap !== "undefined" && bootstrap.Tooltip) {
    const tooltipTriggerList = [].slice.call(
      document.querySelectorAll('[data-bs-toggle="tooltip"]')
    );
    tooltipTriggerList.map(function (tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl);
    });
  }
}

/**
 * Handle responsive behavior for mobile devices
 */
function handleResponsiveBehavior() {
  const isMobile = window.innerWidth < 768;

  if (isMobile) {
    // Adjust viewer heights for mobile
    const viewers = document.querySelectorAll(".molstar-container");
    viewers.forEach((viewer) => {
      viewer.style.height = "300px";
    });

    // Adjust large viewer for mobile
    const largeViewer = document.querySelector(".molstar-container.large");
    if (largeViewer) {
      largeViewer.style.height = "350px";
    }
  }
}

// Handle window resize
window.addEventListener("resize", handleResponsiveBehavior);

// Initialize responsive behavior on load
document.addEventListener("DOMContentLoaded", handleResponsiveBehavior);

// Export functions for global access (if needed)
window.dockingResults = {
  toggleLogDetails,
  downloadLog,
  downloadConfig,
  loadMolstarProtein,
  loadMolstarPeptide,
  loadMolstarComplex,
  hideMolstarExpandButtons,
};

console.log("✅ Docking Results JavaScript fully loaded");
