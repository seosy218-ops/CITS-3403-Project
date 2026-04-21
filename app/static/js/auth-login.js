document.addEventListener("DOMContentLoaded", () => {
  /* ── 1. Bootstrap-style form validation ── */
  const form = document.querySelector(".needs-validation");
  const submitBtn = form?.querySelector(".auth-submit-btn");
  const submitLabel = submitBtn?.textContent;

  if (form) {
    form.addEventListener("submit", (e) => {
      if (!form.checkValidity()) {
        e.preventDefault();
        e.stopPropagation();
      } else if (submitBtn) {
        // Show loading state when validation passes
        submitBtn.disabled = true;
        submitBtn.innerHTML =
          '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Signing in\u2026';
      }
      form.classList.add("was-validated");
    });
  }

  // Reset button on back-navigation (bfcache)
  window.addEventListener("pageshow", () => {
    if (submitBtn && submitBtn.disabled) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
      form.classList.remove("was-validated");
    }
  });

  /* ── 2. Password visibility toggle ── */
  const toggle = document.querySelector(".password-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const input = document.getElementById("password");
      const icon = toggle.querySelector("i");
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      icon.classList.toggle("bi-eye", !isHidden);
      icon.classList.toggle("bi-eye-slash", isHidden);
    });
  }

  /* ── 3. Demo credential auto-fill buttons ── */
  document.querySelectorAll(".auth-demo-fill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const emailInput = document.getElementById("email");
      const passInput = document.getElementById("password");
      emailInput.value = btn.dataset.email;
      passInput.value = btn.dataset.password;
      // Clear validation state so filled fields don't show stale errors
      form?.classList.remove("was-validated");
      // Brief visual confirmation
      btn.classList.add("auth-demo-filled");
      setTimeout(() => btn.classList.remove("auth-demo-filled"), 400);
    });
  });

  /* ── 4. Dismiss flash alerts ── */
  document.querySelectorAll(".auth-alert-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".auth-alert").remove();
    });
  });
});
