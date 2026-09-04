// @ts-nocheck — vanilla theme asset, not part of the app TS project
/**
 * Evoloop assistant slot (Horizon build) — P1 restraint (no 'AI' in copy).
 * Reads a [data-evo-assistant-root] node carrying data-backend / data-title /
 * data-handle / data-url; lazy-loads <backend>/assistant-widget.js when the
 * merchant configured the theme setting. Zero presence otherwise.
 *
 * Contract (also in themes/evoloop/README.md):
 *  - mount node stays empty; the widget mounts itself onto it
 *  - clicking the 'Find my size' trigger fires a bubbling CustomEvent
 *    'evoloop:assistant-open' with { mode: 'size-fit', product }
 *  - if the widget exposes window.EvoloopAssistant.open it is called too
 */
;(() => {
  function init() {
    var root = document.querySelector('[data-evo-assistant-root]')
    if (!root) return
    var backend = root.getAttribute('data-backend') || ''
    if (!backend) return
    var product = {
      title: root.getAttribute('data-title') || '',
      handle: root.getAttribute('data-handle') || '',
      url: root.getAttribute('data-url') || '',
    }
    var findBtn = document.querySelector('[data-evo-find-size]')
    var loaded = false

    function loadWidget() {
      if (loaded) return
      loaded = true
      var script = document.createElement('script')
      script.src = backend.replace(/\/+$/, '') + '/assistant-widget.js'
      script.async = true
      document.head.appendChild(script)
    }

    /** @param {string} mode */
    function open(mode) {
      window.dispatchEvent(
        new CustomEvent('evoloop:assistant-open', {
          detail: { mode: mode, product: product },
          bubbles: true,
        }),
      )
      // Theme asset reads the global exposed by the assistant widget (if any).
      // @ts-ignore
      var api = window['EvoloopAssistant']
      if (api && typeof api.open === 'function') {
        api.open(mode, product)
      }
    }

    loadWidget()
    if (findBtn) {
      findBtn.addEventListener('click', () => {
        open('size-fit')
      })
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
