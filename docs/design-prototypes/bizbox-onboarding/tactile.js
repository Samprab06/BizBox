/* global BizBoxLiquid */
/* GetA5 reference transfer: direct held gesture, curved ruler, deterministic detents.
   The real native range retains keyboard, accessibility and submitted value. */
(() => {
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function mount(input) {
    const host = input.closest(".tactile-range"),
      surface = host.querySelector(".ruler-surface");
    if (!surface) return;
    const canvas = surface.querySelector("canvas"),
      ctx = canvas.getContext("2d");
    let observer;
    let width = 0,
      raf = 0,
      drag = null,
      raw = Number(input.value),
      lastValue = raw;
    const increment = () => Number(input.dataset.detent) || 1,
      min = () => Number(input.min),
      max = () => Number(input.max);
    const reduced = () => BizBoxLiquid.reduced();
    function draw(value = Number(input.value), stretch = 0) {
      raw = value;
      const w = surface.clientWidth,
        dpr = Math.min(devicePixelRatio || 1, 1.5);
      if (width !== w) {
        width = w;
        canvas.width = Math.ceil(w * dpr);
        canvas.height = Math.ceil(100 * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = "100px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, width, 100);
      const unit = increment(),
        middle = width / 2,
        radius = width * 0.72,
        space = 14,
        index = (value - min()) / unit,
        start = Math.floor(index - width / space / 2) - 3,
        end = Math.ceil(index + width / space / 2) + 3;
      for (let i = start; i <= end; i++) {
        const amount = min() + i * unit;
        if (amount < min() || amount > max()) continue;
        const delta = (i - index) * space,
          a = delta / radius,
          x = middle + Math.sin(a) * radius;
        if (x < 0 || x > width || Math.abs(a) > 1.35) continue;
        const opacity = Math.pow(Math.max(0, Math.cos(a)), 3) * 0.78,
          major = i % 5 === 0,
          y = 17 + (1 - Math.cos(a)) * 18;
        ctx.strokeStyle = `rgba(237,243,252,${opacity})`;
        ctx.lineWidth = major ? 1.8 : 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + (major ? 26 : 12) * Math.cos(a));
        ctx.stroke();
        if (major) {
          const label =
            input.dataset.bind === "staff"
              ? String(amount)
              : amount >= 1000
                ? `${Number((amount / 1000).toFixed(1))}k`
                : String(amount);
          ctx.fillStyle = `rgba(237,243,252,${opacity * 0.9})`;
          ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(label, x, y + 52);
        }
      }
      surface.style.setProperty("--stretch", String(stretch));
    }
    function emit(value) {
      input.value = String(
        clamp(
          Math.round((value - min()) / increment()) * increment() + min(),
          min(),
          max(),
        ),
      );
      if (Number(input.value) !== lastValue) {
        lastValue = Number(input.value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    input.ruler = {
      draw: () => {
        if (!drag && !raf) draw();
      },
      stop,
      destroy: () => {
        stop();
        observer?.disconnect();
        drag = null;
      },
    };
    draw();
    input.addEventListener("input", () => {
      if (!drag && !raf) draw();
    });
    input.addEventListener("keydown", (event) => {
      const actions = {
        ArrowRight: increment(),
        ArrowUp: increment(),
        ArrowLeft: -increment(),
        ArrowDown: -increment(),
        PageUp: increment() * 10,
        PageDown: -increment() * 10,
      };
      if (!(event.key in actions) && !["Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      stop();
      const value =
        event.key === "Home"
          ? min()
          : event.key === "End"
            ? max()
            : Number(input.value) + actions[event.key];
      input.value = String(clamp(value, min(), max()));
      lastValue = Number(input.value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      draw();
    });
    input.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      stop();
      event.preventDefault();
      input.focus({ preventScroll: true });
      input.setPointerCapture(event.pointerId);
      drag = {
        id: event.pointerId,
        x: event.clientX,
        start: Number(input.value),
        last: Number(input.value),
        t: event.timeStamp,
        velocity: 0,
        moved: false,
      };
      host.classList.add("is-dragging");
    });
    input.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const next = drag.start - ((event.clientX - drag.x) / 14) * increment(),
        bounded = clamp(next, min(), max()),
        dt = Math.max(1, event.timeStamp - drag.t);
      drag.velocity = dt > 100 ? 0 : (bounded - drag.last) / dt;
      drag.last = bounded;
      drag.t = event.timeStamp;
      drag.moved ||= Math.abs(event.clientX - drag.x) > 3;
      emit(bounded);
      const edge = (next - bounded) / increment();
      draw(
        bounded + Math.tanh(edge * 0.13) * increment() * 0.7,
        reduced() ? 0 : clamp((drag.velocity / increment()) * 3, -0.12, 0.12),
      );
    });
    function release(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const held = drag;
      drag = null;
      host.classList.remove("is-dragging");
      if (input.hasPointerCapture(event.pointerId))
        input.releasePointerCapture(event.pointerId);
      const cancelled =
        event.type === "pointercancel" || event.type === "lostpointercapture";
      if (!held.moved && !cancelled) {
        const r = input.getBoundingClientRect();
        emit(
          Number(input.value) +
            ((event.clientX - r.left - r.width / 2) / 14) * increment(),
        );
        draw();
        return;
      }
      const velocity = event.timeStamp - held.t > 90 ? 0 : held.velocity;
      const coast = cancelled
          ? 0
          : clamp(velocity * 85, -increment() * 7, increment() * 7),
        start = raw;
      const target = clamp(
        Math.round((held.last + coast - min()) / increment()) * increment() +
          min(),
        min(),
        max(),
      );
      if (reduced() || cancelled) {
        emit(target);
        draw();
        return;
      }
      let startTime;
      const frame = (now) => {
        startTime ??= now;
        const p = Math.min(1, (now - startTime) / 240),
          e = 1 - Math.pow(1 - p, 3),
          v = start + (target - start) * e;
        emit(v);
        draw(v, (1 - p) * clamp((velocity / increment()) * 3, -0.12, 0.12));
        if (p < 1) raf = requestAnimationFrame(frame);
        else {
          raf = 0;
          emit(target);
          draw();
        }
      };
      raf = requestAnimationFrame(frame);
    }
    input.addEventListener("pointerup", release);
    input.addEventListener("pointercancel", release);
    input.addEventListener("lostpointercapture", release);
    observer = new ResizeObserver(() => {
      if (!drag && !raf) draw();
    });
    observer.observe(surface);
  }
  window.BizBoxRuler = { mount };
})();
