(function () {
  function init(section) {
    var details = section.querySelectorAll(".shop-data-faq__details");
    details.forEach(function (current) {
      current.addEventListener("toggle", function () {
        if (!current.open) return;
        details.forEach(function (other) {
          if (other !== current && other.open) other.open = false;
        });
      });
    });
  }

  function setup() {
    document
      .querySelectorAll('.shop-data-faq[data-single-open="true"]')
      .forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();
