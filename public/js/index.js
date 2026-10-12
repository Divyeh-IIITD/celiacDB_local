// Main JavaScript file for HLA-DQ Protein Analysis Platform

document.addEventListener("DOMContentLoaded", function () {
  // Initialize animations
  initializeAnimations();

  // Initialize smooth scrolling
  initializeSmoothScrolling();

  // Initialize interactive elements
  initializeInteractiveElements();

  // Initialize performance optimizations
  initializePerformanceOptimizations();
});

// Animation initialization
function initializeAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px",
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("fade-in-up");
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe elements for animation
  const animatedElements = document.querySelectorAll(
    ".option-card, .feature-item, .step, .notice-card"
  );
  animatedElements.forEach((el) => observer.observe(el));
}

// Smooth scrolling for anchor links
function initializeSmoothScrolling() {
  const links = document.querySelectorAll('a[href^="#"]');

  links.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();

      const targetId = link.getAttribute("href");
      const targetElement = document.querySelector(targetId);

      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });
  });
}

// Interactive elements initialization
function initializeInteractiveElements() {
  // Add hover effects to cards
  const cards = document.querySelectorAll(".option-card, .feature-item");

  cards.forEach((card) => {
    card.addEventListener("mouseenter", function () {
      this.style.transform = "translateY(-8px) scale(1.02)";
    });

    card.addEventListener("mouseleave", function () {
      this.style.transform = "translateY(0) scale(1)";
    });
  });

  // Button click animations
  const buttons = document.querySelectorAll(".btn");

  buttons.forEach((button) => {
    button.addEventListener("click", function (e) {
      if (this.disabled) return;

      // Create ripple effect
      const ripple = document.createElement("span");
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;

      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = x + "px";
      ripple.style.top = y + "px";
      ripple.classList.add("ripple");

      this.appendChild(ripple);

      setTimeout(() => {
        ripple.remove();
      }, 600);
    });
  });

  // Navbar scroll effect (if navbar exists)
  const navbar = document.querySelector(".navbar");
  if (navbar) {
    window.addEventListener("scroll", () => {
      if (window.scrollY > 100) {
        navbar.classList.add("scrolled");
      } else {
        navbar.classList.remove("scrolled");
      }
    });
  }

  // Statistics counter animation
  const statNumbers = document.querySelectorAll(".stat-number");
  const observerStats = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        observerStats.unobserve(entry.target);
      }
    });
  });

  statNumbers.forEach((stat) => observerStats.observe(stat));
}

// Counter animation for statistics
function animateCounter(element) {
  const target = parseInt(element.textContent.replace(/\D/g, ""));
  if (isNaN(target)) return;

  const duration = 2000;
  const step = target / (duration / 16);
  let current = 0;

  const timer = setInterval(() => {
    current += step;
    if (current >= target) {
      current = target;
      clearInterval(timer);
    }

    element.textContent = Math.floor(current).toLocaleString();

    // Add back any non-numeric characters
    const originalText = element.dataset.original || element.textContent;
    if (originalText.includes("∞")) {
      element.textContent = "∞";
    }
  }, 16);
}

// Performance optimizations
function initializePerformanceOptimizations() {
  // Lazy loading for images
  const images = document.querySelectorAll("img[data-src]");
  const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.removeAttribute("data-src");
        imageObserver.unobserve(img);
      }
    });
  });

  images.forEach((img) => imageObserver.observe(img));

  // Debounced scroll handler
  let scrollTimeout;
  window.addEventListener("scroll", () => {
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    scrollTimeout = setTimeout(() => {
      // Handle scroll events here
      updateScrollProgress();
    }, 10);
  });
}

// Update scroll progress indicator
function updateScrollProgress() {
  const scrollProgress = document.querySelector(".scroll-progress");
  if (scrollProgress) {
    const scrolled =
      (window.scrollY /
        (document.documentElement.scrollHeight - window.innerHeight)) *
      100;
    scrollProgress.style.width = scrolled + "%";
  }
}

// Utility functions
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function throttle(func, limit) {
  let inThrottle;
  return function () {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Loading state management
function showLoading(element) {
  const loader = document.createElement("div");
  loader.className = "loading";
  element.appendChild(loader);
  element.disabled = true;
}

function hideLoading(element) {
  const loader = element.querySelector(".loading");
  if (loader) {
    loader.remove();
  }
  element.disabled = false;
}

// Error handling
function showError(message, type = "error") {
  const errorDiv = document.createElement("div");
  errorDiv.className = `alert alert-${type}`;
  errorDiv.textContent = message;

  const container = document.querySelector(".container");
  if (container) {
    container.insertBefore(errorDiv, container.firstChild);

    setTimeout(() => {
      errorDiv.remove();
    }, 5000);
  }
}

// Form validation helpers
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePeptideSequence(sequence) {
  // Basic peptide sequence validation (amino acid letters)
  const peptideRegex = /^[ACDEFGHIKLMNPQRSTVWY]+$/i;
  return peptideRegex.test(sequence.replace(/\s/g, ""));
}

// Local storage helpers
function saveToLocalStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("Error saving to localStorage:", error);
    return false;
  }
}

function loadFromLocalStorage(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Error loading from localStorage:", error);
    return null;
  }
}

// Analytics tracking (placeholder)
function trackEvent(action, category, label) {
  // Implement analytics tracking here
  console.log("Event tracked:", { action, category, label });
}

// Accessibility improvements
function initializeAccessibility() {
  // Add keyboard navigation support
  document.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      document.body.classList.add("keyboard-navigation");
    }
  });

  document.addEventListener("mousedown", () => {
    document.body.classList.remove("keyboard-navigation");
  });

  // Skip link functionality
  const skipLink = document.querySelector(".skip-link");
  if (skipLink) {
    skipLink.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.querySelector(skipLink.getAttribute("href"));
      if (target) {
        target.focus();
        target.scrollIntoView();
      }
    });
  }
}

// Initialize accessibility on load
document.addEventListener("DOMContentLoaded", initializeAccessibility);

// Export functions for use in other scripts
window.HLADQPlatform = {
  showLoading,
  hideLoading,
  showError,
  validateEmail,
  validatePeptideSequence,
  saveToLocalStorage,
  loadFromLocalStorage,
  trackEvent,
  debounce,
  throttle,
};
