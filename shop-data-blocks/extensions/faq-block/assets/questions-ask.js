(() => {
  const forms = document.querySelectorAll("[data-questions-ask]");
  forms.forEach((form) => {
    if (form.dataset.bound === "1") return;
    form.dataset.bound = "1";

    const status = form.querySelector("[data-status]");
    const submit = form.querySelector('button[type="submit"]');
    const textarea = form.querySelector("textarea[name='text']");
    const endpoint = form.dataset.endpoint;
    const productId = form.dataset.productId;
    const successMessage = form.dataset.success || "Thanks! We'll email you when we reply.";

    const setStatus = (state, text) => {
      if (!status) return;
      status.textContent = text;
      status.dataset.state = state;
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = (textarea.value || "").trim();
      if (!text) return;

      submit.disabled = true;
      setStatus("pending", "Sending…");

      try {
        const body = new FormData();
        body.set("product_id", productId);
        body.set("text", text);
        const response = await fetch(endpoint, { method: "POST", body });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.ok) {
          textarea.value = "";
          setStatus("success", successMessage);
        } else {
          setStatus("error", data.error || "Something went wrong. Please try again.");
        }
      } catch (error) {
        setStatus("error", "Network error. Please try again.");
      } finally {
        submit.disabled = false;
      }
    });
  });
})();
