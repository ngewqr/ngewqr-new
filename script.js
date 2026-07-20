/* Soft scroll-reveal. Elements start hidden only because the inline
   <script> in <head> added .js to <html> — without JS everything shows. */
(function () {
  var els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      entry.target.classList.add('in');
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });

  els.forEach(function (el) {
    // Stagger siblings inside a card grid for a gentle cascade
    var parent = el.parentElement;
    if (parent && parent.classList.contains('card-grid')) {
      var i = Array.prototype.indexOf.call(parent.children, el);
      el.style.setProperty('--d', (i * 0.08) + 's');
    }
    io.observe(el);
  });
})();
