/* Soft scroll-reveal + selection filters. Elements start hidden only
   because the inline <script> in <head> added .js to <html> —
   without JS everything shows and every item is listed. */
(function () {
  // ---- Scroll reveal ----
  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        entry.target.classList.add('in');
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });

    els.forEach(function (el) {
      // Stagger list rows for a gentle cascade
      var parent = el.parentElement;
      if (parent && parent.classList.contains('selection-list')) {
        var i = Array.prototype.indexOf.call(parent.children, el);
        el.style.setProperty('--d', Math.min(i * 0.06, 0.4) + 's');
      }
      io.observe(el);
    });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  // ---- Selection filters ----
  var list = document.querySelector('.selection-list');
  var filters = document.querySelector('.filters');
  if (!list || !filters) return;

  var items = Array.prototype.slice.call(list.querySelectorAll('.item'));

  // Build one chip per category found in the list, in first-seen order
  var seen = [];
  items.forEach(function (item) {
    var cat = item.getAttribute('data-cat');
    if (cat && seen.indexOf(cat) === -1) seen.push(cat);
  });
  seen.forEach(function (cat) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('data-cat', cat);
    btn.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    filters.appendChild(btn);
  });

  filters.addEventListener('click', function (e) {
    var btn = e.target.closest('.filter');
    if (!btn) return;
    var cat = btn.getAttribute('data-cat');

    filters.querySelectorAll('.filter').forEach(function (b) {
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    });

    items.forEach(function (item) {
      var show = cat === 'all' || item.getAttribute('data-cat') === cat;
      var wasHidden = item.hidden;
      item.hidden = !show;
      item.classList.remove('appear');
      if (show && wasHidden) {
        // restart the fade-in for rows that just became visible
        void item.offsetWidth;
        item.classList.add('appear');
        item.classList.add('in'); // don't leave filtered rows waiting on scroll reveal
      }
    });
  });
})();
