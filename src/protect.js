// Display deterrents (layer 5): no right-click save, no drag-out, on any photo surface.
// This only stops casual saving; the size cap and watermark do the real work.
(() => {
  const PHOTO = '.tile, .ix-img, .v-frame, .portrait, canvas';
  const block = (e) => { if (e.target.closest?.(PHOTO)) e.preventDefault(); };
  document.addEventListener('contextmenu', block);
  document.addEventListener('dragstart', block);
})();
