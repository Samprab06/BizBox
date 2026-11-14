/* Stable glass. Only the new question receives a short opacity fade. */
(() => {
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  async function transition({ swap }) {
    swap();
    const content = document.querySelector(".question-card .card-content");
    if (!content || reduced()) return true;
    const animation = content.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 120,
      easing: "ease-out",
    });
    try {
      await animation.finished;
    } catch {
    } finally {
      animation.cancel();
    }
    return true;
  }
  const noop = () => {};
  window.BizBoxLiquid = {
    transition,
    reduced,
    select: noop,
    impulse: noop,
    mount: noop,
    setPhoto: noop,
  };
})();
