// Thank you modal on #thanks hash (e.g. after Stripe Checkout success).
// Loaded from index.html so the page CSP can drop 'unsafe-inline'.
if (window.location.hash === '#thanks') {
  const modal = document.getElementById('thanksModal');
  modal.style.display = 'flex';
  // Clear hash from URL without reload
  history.replaceState(null, '', window.location.pathname);
  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    modal.classList.add('fade-out');
    setTimeout(() => { modal.style.display = 'none'; }, 500);
  }, 4000);
  // Click to dismiss early
  modal.addEventListener('click', () => {
    modal.classList.add('fade-out');
    setTimeout(() => { modal.style.display = 'none'; }, 500);
  });
}
