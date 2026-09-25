export default defineNuxtPlugin(() => {
  const STEP_PX = 1.5;
  const MIN_PX = 8;
  const MAX_PX = 96;
  const DEFAULT_PX = 16;
  const TARGET_SELECTOR = "#editor-area";

  function isEditable(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
    if (!el) return false;
    const tag = (el as HTMLElement).tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea") return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
  }

  function getCurrentFontSizePx(el: HTMLElement): number {
    const inline = el.style?.fontSize;
    if (inline) {
      const n = parseFloat(inline);
      if (!Number.isNaN(n)) return n;
    }
    const cs = window.getComputedStyle(el);
    const n = parseFloat(cs.fontSize);
    return Number.isNaN(n) ? DEFAULT_PX : n;
  }

  function setFontSizePx(el: HTMLElement, px: number): void {
    const clamped = Math.min(MAX_PX, Math.max(MIN_PX, px));
    el.style.setProperty("font-size", `${clamped}px`, "important");
    const attr = el.getAttribute("input-attrs");
    if (typeof attr === "string") {
      const targetEl = document.getElementById(attr);
      if (targetEl) targetEl.style.setProperty("font-size", `${clamped}px`, "important");
    }
  }

  const handleKeydown = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;
    const key = e.key;
    const code = e.code;
    const plusPressed = key === "+" || key === "=" || code === "Equal" || code === "NumpadAdd";
    const minusPressed = key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract";
    const resetPressed = key === "0" || code === "Digit0" || code === "Numpad0";
    if (!plusPressed && !minusPressed && !resetPressed) return;
    e.preventDefault();
    const focused = document.activeElement as HTMLElement | null;
    const container = document.querySelector(TARGET_SELECTOR);
    if (!container || !focused || !container.contains(focused)) return;
    if (!isEditable(focused)) return;
    if (resetPressed) {
      setFontSizePx(focused, DEFAULT_PX);
      return;
    }
    const current = getCurrentFontSizePx(focused);
    setFontSizePx(focused, plusPressed ? current + STEP_PX : current - STEP_PX);
  };

  window.addEventListener("keydown", handleKeydown, { passive: false });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener("keydown", handleKeydown);
    });
  }
});
