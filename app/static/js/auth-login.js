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

  /* ── 5. Password requirement live feedback (register page) ──
     Mirrors the server-side rules in app/forms.py:SignupForm so
     the user gets instant feedback as they type. The submit
     handler relies on setCustomValidity() to keep the password
     fields invalid until every rule is satisfied — without this,
     `required minlength="8"` alone would let weak passwords pass
     the client-side check and only fail at the server.
     ─────────────────────────────────────────────────────────── */
  const passwordInput = document.getElementById("password");
  const confirmInput  = document.getElementById("confirm_password");
  const requirementList = document.getElementById("password-help");

  if (passwordInput && requirementList) {
    // Must match the special-character set in app/forms.py
    const SPECIAL_RE = /[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/;
    const rules = {
      length:  (v) => v.length >= 8 && v.length <= 128,
      upper:   (v) => /[A-Z]/.test(v),
      lower:   (v) => /[a-z]/.test(v),
      digit:   (v) => /\d/.test(v),
      special: (v) => SPECIAL_RE.test(v),
    };

    const items = requirementList.querySelectorAll("li[data-rule]");

    // Tri-state per rule: neutral (empty input), met (green check), unmet (amber ✗).
    // The unmet state only appears once the user has typed something, so the
    // unfocused empty form doesn't look like a wall of errors.
    function evaluatePassword() {
      const value = passwordInput.value;
      const hasInput = value !== "";
      let allMet = true;

      items.forEach((li) => {
        const rule = li.dataset.rule;
        const met = rules[rule] ? rules[rule](value) : false;
        li.classList.toggle("met", met);
        li.classList.toggle("unmet", hasInput && !met);
        const icon = li.querySelector("i");
        if (icon) {
          icon.classList.toggle("bi-check-circle-fill", met);
          icon.classList.toggle("bi-x-circle-fill", hasInput && !met);
          icon.classList.toggle("bi-circle", !hasInput || (!met && !hasInput));
        }
        if (!met) allMet = false;
      });

      // Block native submit until every rule is satisfied. Empty value is
      // left to `required` so the unfocused empty state stays clean.
      passwordInput.setCustomValidity(
        !hasInput || allMet ? "" : "Password does not meet all requirements."
      );

      // Re-validate the confirm field whenever the source changes
      if (confirmInput) checkPasswordMatch();
    }

    function checkPasswordMatch() {
      if (!confirmInput) return;
      const mismatch = confirmInput.value !== "" &&
                       confirmInput.value !== passwordInput.value;
      confirmInput.setCustomValidity(mismatch ? "Passwords do not match." : "");
      // Inline mismatch hint sibling to the input
      const hint = document.getElementById("confirm-password-hint");
      if (hint) hint.classList.toggle("show", mismatch);
    }

    passwordInput.addEventListener("input", evaluatePassword);
    if (confirmInput) confirmInput.addEventListener("input", checkPasswordMatch);

    // Initial paint in case the browser autofills the password field
    evaluatePassword();
  }

});
