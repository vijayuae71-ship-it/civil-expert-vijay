/* A progress bar for long AI jobs (full BOQs, reading a tender, rates, checks).
 * The AI doesn't report its progress, so the % is an estimate from how long this kind of job usually
 * takes: it rises quickly at first, slows down, never passes 95% on its own, and jumps to 100% when
 * the answer arrives. The step text changes as it goes, so people can see work is happening.
 *   const p = Progress.start(element, { expectedMs: 70000, steps: [[0, "Reading…"], [40, "Writing…"]] });
 *   …later: p.done()  (fills to 100% and removes itself)  or  p.stop()  (removes at once)
 */
(function (root) {
  "use strict";
  // Share of the work done after `elapsed` ms, for a job that usually takes `expected` ms.
  function estimate(elapsed, expected) {
    if (!(expected > 0)) return 0;
    return Math.min(95, 95 * (1 - Math.exp((-1.6 * Math.max(0, elapsed)) / expected)));
  }
  function stepFor(pct, steps) {
    let text = "";
    for (const [from, label] of steps || []) if (pct >= from) text = label;
    return text;
  }
  function start(el, { expectedMs = 60000, steps = [], className = "" } = {}) {
    if (!el || typeof document === "undefined") return { done() {}, stop() {} };
    const box = document.createElement("div");
    box.className = `cae-progress ${className}`;
    box.setAttribute("role", "progressbar");
    box.setAttribute("aria-valuemin", "0"); box.setAttribute("aria-valuemax", "100");
    box.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:1.4"><span class="cae-step"></span><span class="cae-pct" style="font-variant-numeric:tabular-nums;font-weight:700"></span></div>' +
      '<div style="margin-top:4px;height:6px;border-radius:999px;background:rgba(100,116,139,.2);overflow:hidden"><div class="cae-fill" style="height:100%;width:0;border-radius:999px;background:#2563eb;transition:width .4s ease"></div></div>';
    el.appendChild(box);
    const t0 = Date.now();
    const paint = (pct) => {
      const p = Math.round(pct);
      box.querySelector(".cae-fill").style.width = `${p}%`;
      box.querySelector(".cae-pct").textContent = `${p}%`;
      box.querySelector(".cae-step").textContent = stepFor(p, steps);
      box.setAttribute("aria-valuenow", String(p));
    };
    paint(2);
    const timer = setInterval(() => paint(Math.max(2, estimate(Date.now() - t0, expectedMs))), 500);
    return {
      done() { clearInterval(timer); paint(100); setTimeout(() => box.remove(), 600); },
      stop() { clearInterval(timer); box.remove(); }
    };
  }
  const api = { estimate, stepFor, start };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Progress = api;
})(typeof self !== "undefined" ? self : this);
