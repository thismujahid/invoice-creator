export default defineNuxtPlugin(() => {
  const STEP_PX = 1.5
  const MIN_PX = 8
  const MAX_PX = 96
  const DEFAULT_PX = 16
  const TARGET_SELECTOR = '#editor-area' // غيّرها لو عندك ID مختلف

  function isEditable(el) {
    if (!el) return false
    const tag = el.tagName?.toLowerCase()
    if (tag === 'input' || tag === 'textarea') return true
    if (el.isContentEditable) return true
    return false
  }

  function getCurrentFontSizePx(el) {
    const inline = el.style?.fontSize
    if (inline) {
      const n = parseFloat(inline)
      if (!isNaN(n)) return n
    }
    const cs = window.getComputedStyle(el)
    const n = parseFloat(cs.fontSize)
    return isNaN(n) ? DEFAULT_PX : n
  }

  function setFontSizePx(el, px) {
    const clamped = Math.min(MAX_PX, Math.max(MIN_PX, px))
    el.style.setProperty('font-size', clamped + 'px', 'important');
    if (typeof el.getAttribute('input-attrs') === 'string') {
      const targetEl = document.getElementById(el.getAttribute('input-attrs'));
      if (targetEl) {
        targetEl.style.setProperty('font-size', clamped + 'px', 'important');
      }
    }
  }

  const handleKeydown = (e) => {
    // لازم يكون Ctrl + Alt مضغوطين
    if (!(e.ctrlKey || e.metaKey) || !e.altKey) return

    const key = e.key
    const code = e.code

    const plusPressed =
      key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd'
    const minusPressed =
      key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract'
    const resetPressed =
      key === '0' || code === 'Digit0' || code === 'Numpad0'

    if (!plusPressed && !minusPressed && !resetPressed) return
    e.preventDefault()

    const focused = document.activeElement
    const container = document.querySelector(TARGET_SELECTOR)
    if (!container || !container.contains(focused)) return
    if (!isEditable(focused)) return

    if (resetPressed) {
      setFontSizePx(focused, DEFAULT_PX)
      console.log('Font reset →', DEFAULT_PX)
      return
    }

    const current = getCurrentFontSizePx(focused)
    const next = plusPressed ? (current + STEP_PX) : (current - STEP_PX)
    setFontSizePx(focused, next)
    console.log('Font size changed →', next)
  }

  window.addEventListener('keydown', handleKeydown, { passive: false })

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('keydown', handleKeydown)
    })
  }

  console.log('[fontResizer] plugin loaded ✅ (Ctrl + Alt + + / - / 0)')
})
