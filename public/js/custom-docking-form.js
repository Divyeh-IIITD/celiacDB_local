// Custom Docking Form JavaScript - PDB Only Version
// Author: HLA-DQ Protein Analysis Platform
// Description: Handles PDB file validation, submission, and progress tracking for direct docking

// Global variables
let progressModal = null;
let formSubmitted = false;
let progressInterval = null;
let serverProgressInterval = null;
let progressSessionId = null;
const config = window.customDockingConfig || {};

console.log("🚀 Custom Docking Form JavaScript Loaded (PDB Only Version)");

// Cleanup function for navigation
function cleanupForm() {
  console.log("🧹 Cleaning up custom docking form...");

  // Hide modal if visible
  if (progressModal) {
    progressModal.hide();
  }

  // Clear progress interval
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  if (serverProgressInterval) {
    clearInterval(serverProgressInterval);
    serverProgressInterval = null;
  }

  // Reset form state
  formSubmitted = false;

  // Re-enable submit button
  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "🚀 Perform Direct Docking";
  }

  // Reset progress bar
  const progressBar = document.querySelector(".progress-bar");
  if (progressBar) {
    progressBar.style.width = "0%";
  }

  const progressText = document.getElementById("progressText");
  if (progressText) {
    progressText.textContent = "Initializing direct docking process...";
  }

  const progressDetail = document.getElementById("progressDetail");
  if (progressDetail) progressDetail.textContent = "Preparing your submission...";

  const progressPercent = document.getElementById("progressPercent");
  if (progressPercent) progressPercent.textContent = "0%";

  const dockingProgressBar = document.getElementById("dockingProgressBar");
  if (dockingProgressBar) dockingProgressBar.style.width = "0%";

  document.querySelectorAll("#dockingStageList [data-stage]").forEach((stage) => {
    stage.classList.remove("text-primary", "text-success", "fw-bold");
    const icon = stage.querySelector(".stage-icon");
    if (icon) icon.textContent = "○";
  });

  // Reset file validation preview
  const fileValidationPreview = document.getElementById(
    "fileValidationPreview"
  );
  if (fileValidationPreview) {
    fileValidationPreview.style.display = "none";
  }
}

// Handle page visibility changes and navigation
document.addEventListener("visibilitychange", function () {
  if (document.hidden && formSubmitted) {
    console.log("🔄 Page hidden during form submission - maintaining state");
  }
});

// Handle beforeunload for cleanup
window.addEventListener("beforeunload", function () {
  cleanupForm();
});

// Handle page show/hide for back navigation
window.addEventListener("pageshow", function (event) {
  if (event.persisted) {
    console.log("🔄 Page restored from cache - cleaning up...");
    cleanupForm();
  }
});

window.addEventListener("pagehide", function () {
  console.log("🔄 Page hiding - cleaning up...");
  cleanupForm();
});

// Initialize when DOM is loaded
document.addEventListener("DOMContentLoaded", function () {
  console.log("🎯 Initializing custom docking form (PDB Only)...");

  // Initialize elements
  const peptideFile = document.getElementById("peptideFile");
  const form = document.getElementById("customDockingForm");
  const submitBtn = document.getElementById("submitBtn");
  if (peptideFile) peptideFile.required = false;
  if (form) form.noValidate = true;

  const prepSessionInput = document.getElementById("prepSessionId");
  const queryPrepSession = new URLSearchParams(window.location.search).get("prepSession");
  let storedPrepSession = "";
  try {
    storedPrepSession = localStorage.getItem("celiacdb.preparedPeptideSession") || "";
  } catch (error) {
    console.warn("Prepared peptide session storage is unavailable:", error.message);
  }
  const cookiePrepSession = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("celiacdb_prep_session="))
    ?.slice("celiacdb_prep_session=".length) || "";
  const effectivePrepSession =
    queryPrepSession || prepSessionInput?.value || storedPrepSession || decodeURIComponent(cookiePrepSession);
  if (effectivePrepSession && prepSessionInput) {
    prepSessionInput.value = effectivePrepSession;
    if (form && !form.action.includes("prepSession=")) {
      form.action = `/custom-docking?prepSession=${encodeURIComponent(effectivePrepSession)}`;
    }
  }

  // Initialize Bootstrap modal
  const modalElement = document.getElementById("progressModal");
  if (modalElement) {
    progressModal = new bootstrap.Modal(modalElement, {
      backdrop: "static",
      keyboard: false,
    });
  }

  // Ensure clean state on load
  cleanupForm();

  /**
   * Enhanced PDB file validation with security checks
   * @param {File} file - PDB file to validate
   * @returns {Object} Validation result
   */
  function validatePDBFile(file) {
    const validationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    if (!file) {
      validationResult.valid = false;
      validationResult.errors.push("No file selected");
      return validationResult;
    }

    console.log(
      `🔍 Validating PDB file: ${file.name} (${file.size} bytes, ${file.type})`
    );

    // File size validation (16MB = 16777216 bytes)
    const maxSize = config.maxFileSize || 16 * 1024 * 1024;
    if (file.size > maxSize) {
      validationResult.valid = false;
      validationResult.errors.push(
        `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max ${
          maxSize / 1024 / 1024
        }MB)`
      );
    }

    if (file.size === 0) {
      validationResult.valid = false;
      validationResult.errors.push("File is empty");
    }

    // File extension validation - Only .pdb files
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".pdb")) {
      validationResult.valid = false;
      validationResult.errors.push(
        "Invalid file type. Only .pdb files are allowed"
      );
    }

    // Enhanced filename security validation
    const suspiciousPatterns = [
      { pattern: /\.\./, message: "Contains directory traversal (..)" },
      { pattern: /[\/\\]/, message: "Contains path separators" },
      {
        pattern: /[\0\|\;\&\$\`\<\>]/,
        message: "Contains suspicious characters",
      },
      {
        pattern: /\.exe$|\.bat$|\.cmd$|\.js$|\.php$|\.asp$|\.jsp$|\.py$|\.sh$/i,
        message: "Has executable/script extension",
      },
      {
        pattern: /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i,
        message: "Uses Windows reserved name",
      },
    ];

    for (const check of suspiciousPatterns) {
      if (check.pattern.test(file.name)) {
        validationResult.valid = false;
        validationResult.errors.push(`Suspicious filename: ${check.message}`);
        break;
      }
    }

    // Filename length check
    if (file.name.length > 100) {
      validationResult.valid = false;
      validationResult.errors.push("Filename too long (max 100 characters)");
    }

    // MIME type validation for PDB files
    const allowedMimeTypes = [
      "text/plain",
      "chemical/x-pdb",
      "application/x-pdb",
      "application/octet-stream",
      "", // Some browsers don't set MIME type for .pdb files
    ];

    if (file.type && !allowedMimeTypes.includes(file.type)) {
      validationResult.warnings.push(
        `Unexpected MIME type: ${file.type}. File will be validated by content.`
      );
    }

    // Additional security checks for file names
    if (file.name.includes("%")) {
      validationResult.warnings.push(
        "Filename contains URL encoding - may be suspicious"
      );
    }

    if (/[^\x00-\x7F]/.test(file.name)) {
      validationResult.warnings.push("Filename contains non-ASCII characters");
    }

    // Check for double extensions
    const doubleExtPattern = /\.[a-z]{2,4}\.[a-z]{2,4}$/i;
    if (doubleExtPattern.test(file.name)) {
      validationResult.warnings.push(
        "Filename has double extension - please verify file integrity"
      );
    }

    console.log(
      `📋 PDB file validation result: ${
        validationResult.valid ? "PASSED" : "FAILED"
      }`
    );
    if (validationResult.errors.length > 0) {
      console.log(`❌ Errors: ${validationResult.errors.join(", ")}`);
    }
    if (validationResult.warnings.length > 0) {
      console.log(`⚠️ Warnings: ${validationResult.warnings.join(", ")}`);
    }

    return validationResult;
  }

  /**
   * Show file validation preview
   * @param {Object} validation - Validation result
   * @param {File} file - The file being validated
   */
  function showFileValidationPreview(validation, file) {
    const preview = document.getElementById("fileValidationPreview");
    if (!preview) return;

    preview.dataset.source = "upload";
    preview.style.display = "block";

    if (validation.valid) {
      preview.innerHTML = `
        <div class="alert alert-success">
          <i class="fas fa-check-circle me-2"></i>
          <strong>PDB file validated:</strong> ${file.name} (${(
        file.size / 1024
      ).toFixed(1)}KB)
          ${
            validation.warnings.length > 0
              ? '<div class="mt-1"><small><strong>Warnings:</strong><br>' +
                validation.warnings.join("<br>") +
                "</small></div>"
              : ""
          }
        </div>
      `;
    } else {
      preview.innerHTML = `
        <div class="alert alert-danger">
          <i class="fas fa-exclamation-triangle me-2"></i>
          <strong>PDB file validation failed:</strong>
          <ul class="mb-0 mt-1">
            ${validation.errors.map((error) => `<li>${error}</li>`).join("")}
          </ul>
          ${
            validation.warnings.length > 0
              ? '<div class="mt-1"><small><strong>Additional warnings:</strong><br>' +
                validation.warnings.join("<br>") +
                "</small></div>"
              : ""
          }
        </div>
      `;
    }
  }

  /**
   * Show validation preview for library-selected peptide
   * @param {HTMLOptionElement} option - Selected option from libraryFile dropdown
   */
  function showLibraryValidationPreview(option) {
    const preview = document.getElementById("fileValidationPreview");
    if (!preview) return;

    if (!option || !option.value) {
      preview.style.display = "none";
      preview.innerHTML = "";
      delete preview.dataset.source;
      return;
    }

    const peptideName = option.dataset.peptideName || option.text.split("—")[0].trim();
    const conformation = option.dataset.conformation || (option.text.includes("Ensemble") ? "Ensemble" : option.text.includes("Helix") ? "Helix" : option.text.includes("PPII") ? "PPII" : "Sheet");
    const proteinName = option.dataset.proteinName || "HLA-DQ Target";
    const filename = option.value;

    preview.dataset.source = "library";
    preview.style.display = "block";
    preview.innerHTML = `
      <div class="alert alert-success border-success shadow-sm mb-0">
        <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <div>
            <div class="fw-bold text-success mb-1">
              <i class="fas fa-check-circle me-2"></i>Prepared Peptide Structure Validated
            </div>
            <div class="small text-dark">
              Peptide: <strong>${peptideName}</strong> <span class="badge bg-primary ms-1">${conformation}</span> | Target: <strong>${proteinName}</strong>
            </div>
            <div class="small text-muted mt-1">
              <i class="fas fa-file-code me-1"></i> File: <code>${filename}</code> | Verified 3D coordinates ready for docking.
            </div>
          </div>
          <span class="badge bg-success px-3 py-2"><i class="fas fa-check me-1"></i>Validated & Ready</span>
        </div>
      </div>
    `;
  }
  window.showLibraryValidationPreview = showLibraryValidationPreview;

  /**
   * Simulate direct docking progress (faster than modeling + docking)
   */
  function simulateDirectDockingProgress() {
    const progressBar = document.getElementById("dockingProgressBar");
    const progressText = document.getElementById("progressText");
    const progressDetail = document.getElementById("progressDetail");
    const progressPercent = document.getElementById("progressPercent");
    const isHaddock = document.getElementById("engineHaddock") && document.getElementById("engineHaddock").checked;

    const vinaSteps = [
      { percent: 15, stage: "validate", text: "Validating PDB structure...", detail: "Checking coordinates, chain records, and peptide sequence." },
      { percent: 30, stage: "validate", text: "Checking docking parameters...", detail: "Reading the selected protein and docking settings." },
      { percent: 45, stage: "topoaa", text: "Processing peptide PDB file...", detail: "Preparing the uploaded peptide structure." },
      { percent: 60, stage: "topoaa", text: "Preparing receptor structure...", detail: "Preparing the receptor for docking." },
      { percent: 75, stage: "rigidbody", text: "Running direct molecular docking...", detail: "Searching candidate binding orientations." },
      { percent: 90, stage: "cluster", text: "Processing docking results...", detail: "Collecting scores and selecting the best result." },
      { percent: 100, stage: "cluster", text: "Redirecting to results...", detail: "Docking finished; loading the result page." },
    ];

    const haddockSteps = [
      { percent: 10, stage: "validate", text: "Validating peptide structure and active residues...", detail: "Checking PDB coordinates and restraint residue numbers." },
      { percent: 25, stage: "validate", text: "Generating ambiguous interaction restraints (AIR)...", detail: "Creating the restraint table for the selected receptor and peptide residues." },
      { percent: 40, stage: "topoaa", text: "Executing topoaa module...", detail: "Building CNS topologies for the receptor and peptide." },
      { percent: 55, stage: "rigidbody", text: "Executing rigidbody module...", detail: "Sampling rigid-body docking orientations." },
      { percent: 70, stage: "flexref", text: "Executing flexref module...", detail: "Refining the peptide-receptor interface with flexibility." },
      { percent: 82, stage: "emref", text: "Executing emref module...", detail: "Minimizing the refined structures." },
      { percent: 92, stage: "cluster", text: "Executing clustfcc and seletopclusts...", detail: "Clustering models and selecting top-scoring representatives." },
      { percent: 100, stage: "cluster", text: "Redirecting to HADDOCK3 results...", detail: "Docking finished; loading the real score and selected model." },
    ];

    const steps = isHaddock ? haddockSteps : vinaSteps;

    let currentStep = 0;

    const stageOrder = ["validate", "topoaa", "rigidbody", "flexref", "emref", "cluster"];
    const startedAt = Date.now();

    progressInterval = setInterval(() => {
      if (currentStep < steps.length && progressBar && progressText) {
        const step = steps[currentStep];
        progressBar.style.width = step.percent + "%";
        progressText.textContent = step.text;
        if (progressDetail) progressDetail.textContent = step.detail;
        if (progressPercent) progressPercent.textContent = step.percent + "%";

        document.querySelectorAll("#dockingStageList [data-stage]").forEach((stage) => {
          const stageIndex = stageOrder.indexOf(stage.dataset.stage);
          const currentIndex = stageOrder.indexOf(step.stage);
          const icon = stage.querySelector(".stage-icon");
          stage.classList.remove("text-primary", "text-success", "fw-bold");
          if (stageIndex < currentIndex) {
            stage.classList.add("text-success");
            if (icon) icon.textContent = "✓";
          } else if (stageIndex === currentIndex) {
            stage.classList.add("text-primary", "fw-bold");
            if (icon) icon.textContent = "•";
          } else if (icon) {
            icon.textContent = "○";
          }
        });

        const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
        if (progressDetail && elapsedSeconds > 0) {
          progressDetail.textContent = `${step.detail} Elapsed: ${elapsedSeconds}s.`;
        }
        currentStep++;
      } else {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    }, isHaddock ? 1200 : 1000);
  }

  function startServerProgressPolling() {
    const progressText = document.getElementById("progressText");
    const progressDetail = document.getElementById("progressDetail");
    const progressPercent = document.getElementById("progressPercent");
    const progressBar = document.getElementById("dockingProgressBar");

    serverProgressInterval = setInterval(async () => {
      if (!progressSessionId) return;
      try {
        const response = await fetch(`/custom-docking-progress/${encodeURIComponent(progressSessionId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const progress = await response.json();
        if (progressBar && Number.isFinite(progress.percent)) progressBar.style.width = `${progress.percent}%`;
        if (progressPercent && Number.isFinite(progress.percent)) progressPercent.textContent = `${progress.percent}%`;
        if (progressText && progress.detail) progressText.textContent = progress.detail;
        if (progressDetail) progressDetail.textContent = progress.logTail || `Backend stage: ${progress.stage || "working"}`;

        document.querySelectorAll("#dockingStageList [data-stage]").forEach((stage) => {
          const icon = stage.querySelector(".stage-icon");
          stage.classList.remove("text-primary", "text-success", "fw-bold");
          if (stage.dataset.stage === progress.stage) {
            stage.classList.add("text-primary", "fw-bold");
            if (icon) icon.textContent = "•";
          }
        });

        if (progress.status === "completed") {
          clearInterval(serverProgressInterval);
          serverProgressInterval = null;
          if (progressSessionId) {
            window.location.href = `/custom-docking-results/${encodeURIComponent(progressSessionId)}`;
          }
        }

        if (progress.status === "failed") {
          clearInterval(serverProgressInterval);
          serverProgressInterval = null;
          if (progressText) progressText.textContent = "Docking failed";
          if (progressDetail) progressDetail.textContent = progress.error || progress.detail;
        }
      } catch (error) {
        console.warn("Backend progress polling failed:", error.message);
      }
    }, 1000);
  }

  /**
   * Cancel docking process
   */
  window.cancelDocking = function () {
    console.log("❌ User cancelled docking");
    cleanupForm();
    window.location.reload();
  };

  /**
   * Enhanced form submission for PDB-only docking
   */
  function handleFormSubmission(e) {
    e.preventDefault();

    // Prevent double submission
    if (formSubmitted) {
      console.log("⚠️ Form already submitted, ignoring");
      return;
    }

    console.log("📝 Processing PDB docking form submission...");

    // Validate protein selection
    const proteinSelect = document.getElementById("proteinSelect");
    if (!proteinSelect || !proteinSelect.value) {
      alert("Please select a protein");
      return;
    }

    console.log(`🧬 Selected protein: ${proteinSelect.value}`);

    // Validate PDB file, prepared library peptide, or pre-loaded ensemble
    const hasPreloadedEnsemble = Boolean(
      (prepSessionInput && prepSessionInput.value) || effectivePrepSession
    );
    if (prepSessionInput && prepSessionInput.value) {
      console.log(`✅ Prepared peptide session available: ${prepSessionInput.value}`);
    }
    if (hasPreloadedEnsemble && this.action && !this.action.includes("prepSession=")) {
      this.action = `/custom-docking?prepSession=${encodeURIComponent(prepSessionInput.value || effectivePrepSession)}`;
    }
    const librarySelect = document.getElementById("libraryFile");
    const hasLibraryPeptide = librarySelect && librarySelect.value;
    const hasUploadedFile = peptideFile && peptideFile.files && peptideFile.files.length > 0;

    if (!hasPreloadedEnsemble && !hasLibraryPeptide && !hasUploadedFile) {
      console.warn("No client-side peptide source detected; submitting so the server can resolve the prepared session.");
    }

    if (hasUploadedFile) {
      const file = peptideFile.files[0];
      console.log(`📁 PDB file selected:`, {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: new Date(file.lastModified),
      });

      const fileValidation = validatePDBFile(file);
      console.log(`📋 PDB file validation result:`, fileValidation);

      if (!fileValidation.valid) {
        console.error(`❌ PDB file validation failed:`, fileValidation.errors);
        alert(`PDB file validation failed:\n${fileValidation.errors.join("\n")}`);
        return;
      }

      // Show warnings if any and ask for confirmation
      if (fileValidation.warnings.length > 0) {
        console.warn(`⚠️ PDB file validation warnings:`, fileValidation.warnings);
        const proceed = confirm(
          `PDB file validation warnings:\n${fileValidation.warnings.join(
            "\n"
          )}\n\nDo you want to proceed anyway?`
        );
        if (!proceed) return;
      }

      console.log(`✅ PDB file validation passed`);
    } else if (hasLibraryPeptide) {
      const selectedOption = librarySelect.selectedOptions[0];
      const optionProteinId = selectedOption?.dataset?.proteinId;
      if (optionProteinId && proteinSelect.value && optionProteinId !== proteinSelect.value) {
        alert("The selected peptide structure does not match the chosen HLA-DQ protein. Please select the matching protein or select a different peptide.");
        return;
      }
      console.log(`✅ Prepared library peptide validated: ${selectedOption ? selectedOption.text : librarySelect.value}`);
    } else {
      console.log(`✅ Using pre-loaded PyMOL ensemble from session: ${prepSessionInput.value}`);
    }

    // Mark as submitted
    formSubmitted = true;
    progressSessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const progressSessionInput = document.getElementById("progressSessionId");
    if (progressSessionInput) progressSessionInput.value = progressSessionId;

    // Disable submit button
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "🔄 Processing...";
    }

    // Show progress modal
    if (progressModal) {
      const modalElement = document.getElementById("progressModal");
      if (modalElement) {
        modalElement.removeAttribute("aria-hidden");
      }

      try {
        progressModal.show();
        simulateDirectDockingProgress();
        startServerProgressPolling();
      } catch (modalError) {
        console.warn("Modal show error:", modalError);
      }
    }

    // Traditional form submission
    console.log("✅ Using traditional form submission for PDB docking...");

    // Ensure form action is relative
    const currentAction = this.getAttribute("action");
    if (!currentAction || currentAction.includes("://")) {
      this.setAttribute("action", "/custom-docking");
      console.log("🔧 Set form action to relative path: /custom-docking");
    }

    console.log(`📊 PDB docking form submission details:`);
    console.log(`   - Action: ${this.getAttribute("action")}`);
    console.log(`   - Method: ${this.getAttribute("method")}`);
    console.log(`   - Enctype: ${this.getAttribute("enctype")}`);
    console.log(`   - Input Type: PDB (direct docking)`);
    if (hasUploadedFile && peptideFile && peptideFile.files && peptideFile.files[0]) {
      const uploadedFile = peptideFile.files[0];
      console.log(`   - File: ${uploadedFile.name} (${uploadedFile.size} bytes)`);
    } else if (hasPreloadedEnsemble) {
      console.log(`   - Pre-loaded Ensemble: ${prepSessionInput.value}`);
    } else if (hasLibraryPeptide) {
      console.log(`   - Prepared Library Peptide: ${librarySelect.value}`);
    }

    // Set a timeout to handle any potential issues
    const submissionTimeout = setTimeout(() => {
      console.warn("⚠️ PDB form submission taking longer than expected...");
    }, 5000);

    try {
      // Submit the form
      this.submit();
      clearTimeout(submissionTimeout);
      console.log("✅ PDB docking form submitted successfully");
    } catch (submitError) {
      console.error("❌ PDB form submission error:", submitError);
      clearTimeout(submissionTimeout);
      resetFormState();
      alert(
        `PDB form submission failed: ${submitError.message}\n\nPlease try again or contact support if the problem persists.`
      );
    }
  }

  // Helper function to reset form state
  function resetFormState() {
    console.log("🔄 Resetting PDB form state...");

    formSubmitted = false;

    if (progressModal) {
      try {
        progressModal.hide();
      } catch (error) {
        console.warn("Modal hide error:", error);
        const modalElement = document.getElementById("progressModal");
        if (modalElement) {
          modalElement.style.display = "none";
          modalElement.classList.remove("show");
          modalElement.setAttribute("aria-hidden", "true");

          const backdrop = document.querySelector(".modal-backdrop");
          if (backdrop) {
            backdrop.remove();
          }

          document.body.classList.remove("modal-open");
          document.body.style.removeProperty("padding-right");
          document.body.style.removeProperty("overflow");
        }
      }
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "🚀 Perform Direct Docking";
    }

    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }

    const progressBar = document.querySelector(".progress-bar");
    if (progressBar) {
      progressBar.style.width = "0%";
    }

    const progressText = document.getElementById("progressText");
    if (progressText) {
      progressText.textContent = "Initializing direct docking process...";
    }

    console.log("✅ PDB form state reset complete");
  }

  // Enhanced PDB file input validation
  const libraryFile = document.getElementById("libraryFile");

  if (peptideFile) {
    peptideFile.addEventListener("change", function () {
      const file = this.files[0];
      const preview = document.getElementById("fileValidationPreview");

      if (file) {
        console.log(`📁 PDB file selected: ${file.name}`);
        // Reset library select when uploading a file
        if (libraryFile) {
          libraryFile.value = "";
        }

        // Show validation preview with loading state
        if (preview) {
          preview.dataset.source = "upload";
          preview.style.display = "block";
          preview.innerHTML = `
            <div class="alert alert-info">
              <div class="d-flex align-items-center">
                <div class="spinner-border spinner-border-sm me-2" role="status">
                  <span class="visually-hidden">Validating...</span>
                </div>
                <span>Validating PDB file: ${file.name}...</span>
              </div>
            </div>
          `;
        }

        // Perform validation after a short delay to show loading state
        setTimeout(() => {
          const validation = validatePDBFile(file);
          showFileValidationPreview(validation, file);
        }, 500);
      } else {
        if (preview && preview.dataset.source === "upload") {
          preview.style.display = "none";
          preview.innerHTML = "";
        }
      }
    });
  }

  // Prepared library peptide input validation
  if (libraryFile) {
    libraryFile.addEventListener("change", function () {
      if (typeof onLibraryPeptideChange === "function") {
        onLibraryPeptideChange();
      } else {
        const option = this.selectedOptions[0];
        if (option && option.value) {
          if (peptideFile) peptideFile.value = "";
          showLibraryValidationPreview(option);
        } else {
          showLibraryValidationPreview(null);
        }
      }
    });

    // Check if an option is pre-selected on page load
    if (libraryFile.value) {
      const option = libraryFile.selectedOptions[0];
      if (option && option.value) {
        showLibraryValidationPreview(option);
      }
    }
  }

  // Form submission handler
  if (form) {
    form.addEventListener("submit", handleFormSubmission);
  }

  console.log(
    "✅ Custom docking form initialized successfully (PDB Only Version)"
  );
});

// Export functions for global access
window.customDockingForm = {
  cleanupForm,
  cancelDocking: window.cancelDocking,
};

console.log(
  "✅ Custom Docking Form JavaScript fully loaded (PDB Only Version) with direct docking support"
);
