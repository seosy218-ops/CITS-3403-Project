"use strict";

/* ============================================================
   AUTH — Login and Register page interactions
   Covers:
     1. Bootstrap-style client-side form validation
     2. Password show / hide toggle
     3. Demo credential auto-fill buttons
     4. Flash alert dismiss
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  /* ── 1. Form validation ─────────────────────────────────────
     Bootstrap's was-validated class triggers CSS :valid /
     :invalid styles on all inputs. We use the native
     checkValidity() API rather than re-implementing validation.
     The submit button is disabled while the POST is in-flight
     to prevent duplicate submissions.
     ─────────────────────────────────────────────────────────── */
  const form        = document.querySelector(".needs-validation");
  const submitBtn   = form?.querySelector(".auth-submit-btn");
  const submitLabel = submitBtn?.textContent;  // save original label for reset

  if (form) {
    form.addEventListener("submit", (e) => {
      if (!form.checkValidity()) {
        // Stop submission and show inline validation errors
        e.preventDefault();
        e.stopPropagation();
      } else if (submitBtn) {
        // Disable and show spinner so the user knows the form is submitting
        submitBtn.disabled = true;
        submitBtn.innerHTML =
          '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Signing in\u2026';
      }
      form.classList.add("was-validated");  // triggers Bootstrap's red/green field borders
    });
  }

  // Reset the submit button if the user navigates back (bfcache restores the page frozen state)
  window.addEventListener("pageshow", () => {
    if (submitBtn && submitBtn.disabled) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
      form?.classList.remove("was-validated");
    }
  });

  /* ── 2. Password visibility toggle ─────────────────────────
     Switches the input type between "password" (masked) and
     "text" (visible). The icon swaps between bi-eye and
     bi-eye-slash to reflect the current state.
     ─────────────────────────────────────────────────────────── */
  const toggle = document.querySelector(".password-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const input   = document.getElementById("password");
      const icon    = toggle.querySelector("i");
      const isHidden = input.type === "password";

      input.type = isHidden ? "text" : "password";  // toggle between masked and visible

      // Swap icon: eye = currently visible (can hide), eye-slash = currently hidden (can show)
      icon.classList.toggle("bi-eye",       !isHidden);
      icon.classList.toggle("bi-eye-slash",  isHidden);
    });
  }

  /* ── 3. Demo credential auto-fill ──────────────────────────
     Each demo button stores credentials in data-email and
     data-password attributes. Clicking fills the login form
     fields and clears any stale validation state so the user
     can submit immediately.
     ─────────────────────────────────────────────────────────── */
  document.querySelectorAll(".auth-demo-fill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const emailInput = document.getElementById("email");
      const passInput  = document.getElementById("password");

      emailInput.value = btn.dataset.email;       // read from data-email attribute
      passInput.value  = btn.dataset.password;    // read from data-password attribute

      // Remove validation class so pre-filled fields don't show red/green borders
      form?.classList.remove("was-validated");

      // Brief visual feedback: adds a class for 400 ms then removes it
      btn.classList.add("auth-demo-filled");
      setTimeout(() => btn.classList.remove("auth-demo-filled"), 400);
    });
  });

  /* ── 4. Flash alert dismiss ─────────────────────────────────
     Close buttons inside flash alerts remove their parent
     element from the DOM entirely.
     ─────────────────────────────────────────────────────────── */
  document.querySelectorAll(".auth-alert-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".auth-alert").remove();
    });
  });

});
