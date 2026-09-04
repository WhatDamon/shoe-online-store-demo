/**
 * Evoloop theme.js — product-page behaviour only (theme is PDP-focused).
 *  - variant chips → variant id / price / availability (server-rendered data)
 *  - add to bag → /cart/add.js then straight to /checkout (no cart page)
 *  - gallery thumbnails swap the main image
 *  - product recommendations AJAX fill
 *  - Evoloop assistant slot loader (lazy, backend from theme setting)
 */
;(function () {
  'use strict'

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn)
    else fn()
  }

  // ---- variant picker -------------------------------------------------------
  function initVariantPicker() {
    var form = document.querySelector('[data-evo-add-form]')
    if (!form) return
    var dataEl = document.querySelector('[data-evo-variants]')
    var variants = []
    if (dataEl && dataEl.textContent) {
      try {
        variants = JSON.parse(dataEl.textContent)
      } catch (e) {
        variants = []
      }
    }
    var priceEl = document.querySelector('[data-evo-price]')
    var idInput = form.querySelector('[data-evo-variant-id]')
    var submit = form.querySelector('[data-evo-submit]')
    var status = form.querySelector('[data-evo-status]')
    var radios = Array.prototype.slice.call(document.querySelectorAll('[data-evo-option]'))
    if (radios.length === 0) return // default-only variant — buy form already correct

    function selection() {
      var order = []
      radios.forEach(function (radio) {
        if (radio.checked) {
          var pos = parseInt(radio.getAttribute('data-option-position'), 10)
          order[pos - 1] = radio.value
        }
      })
      return order
    }

    function findVariant() {
      var sel = selection()
      if (sel.length === 0) return null
      for (var i = 0; i < variants.length; i++) {
        var v = variants[i]
        if (v.options && v.options.length === sel.length) {
          var match = true
          for (var j = 0; j < sel.length; j++) {
            if (String(v.options[j]) !== String(sel[j])) {
              match = false
              break
            }
          }
          if (match) return v
        }
      }
      return null
    }

    function refresh() {
      var variant = findVariant()
      if (!variant) {
        submit.setAttribute('disabled', 'disabled')
        submit.textContent = 'Select a size'
        if (status) status.textContent = ''
        return
      }
      idInput.value = variant.id
      if (priceEl) priceEl.textContent = variant.price
      if (variant.available) {
        submit.removeAttribute('disabled')
        submit.textContent = 'Add to bag'
        if (status) status.textContent = ''
      } else {
        submit.setAttribute('disabled', 'disabled')
        submit.textContent = 'Sold out'
        if (status) status.textContent = ''
      }
    }

    radios.forEach(function (radio) {
      radio.addEventListener('change', refresh)
    })
    refresh()

    // Navigation only ever points at the hardcoded relative /checkout route —
    // never derived from input — so there is no open-redirect surface.
    function goToCheckout() {
      var link = document.createElement('a')
      link.href = '/checkout'
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var variant = findVariant()
      if (!variant || !variant.available) return
      var btn = submit
      btn.setAttribute('disabled', 'disabled')
      btn.textContent = 'Adding…'
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: variant.id, quantity: 1 }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('cart')
          goToCheckout()
        })
        .catch(function () {
          btn.removeAttribute('disabled')
          btn.textContent = 'Add to bag'
          if (status) {
            status.textContent = 'Something went wrong — please try again.'
          }
        })
    })
  }

  // ---- gallery --------------------------------------------------------------
  function initGallery() {
    var main = document.querySelector('.evo-gallery__main')
    if (!main) return
    var thumbs = document.querySelectorAll('[data-evo-gallery-thumb]')
    Array.prototype.forEach.call(thumbs, function (thumb) {
      thumb.addEventListener('click', function () {
        main.src = thumb.getAttribute('data-src')
        main.alt = thumb.getAttribute('data-alt') || main.alt
        Array.prototype.forEach.call(thumbs, function (other) {
          other.classList.toggle('is-active', other === thumb)
        })
      })
    })
  }

  // ---- recommendations ------------------------------------------------------
  function initRecommendations() {
    var section = document.querySelector('[data-recommendations]')
    if (!section) return
    var url = section.getAttribute('data-url')
    var grid = section.querySelector('[data-recommendations-grid]')
    if (!grid) return // server already rendered recommendations
    fetch(url, { headers: { Accept: 'text/html' } })
      .then(function (res) {
        return res.ok ? res.text() : ''
      })
      .then(function (html) {
        if (!html) return
        var doc = new DOMParser().parseFromString(html, 'text/html')
        var incoming = doc.querySelector('[data-recommendations] .evo-related__grid')
        if (!incoming) return
        var cards = Array.prototype.filter.call(incoming.children, function (node) {
          return node.matches && node.matches('.evo-card')
        })
        if (cards.length === 0) {
          section.hidden = true
          return
        }
        cards.forEach(function (card) {
          grid.appendChild(document.importNode(card, true))
        })
      })
      .catch(function () {
        /* recommendations are enhancement — fail quiet */
      })
  }

  // ---- assistant slot -------------------------------------------------------
  function initAssistant() {
    var root = document.querySelector('[data-evo-assistant-root]')
    if (!root) return
    var backend = root.getAttribute('data-backend') || ''
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
      window.EvoloopAssistantConfig = { backend: backend, product: product, mount: root }
      var script = document.createElement('script')
      script.src = backend.replace(/\/$/, '') + '/assistant-widget.js'
      script.async = true
      script.setAttribute('data-evoloop-mount', 'root')
      document.head.appendChild(script)
    }

    function openAssistant(mode) {
      window.dispatchEvent(
        new CustomEvent('evoloop:assistant-open', {
          detail: { mode: mode || 'size-fit', product: product },
        }),
      )
      if (window.EvoloopAssistant && typeof window.EvoloopAssistant.open === 'function') {
        window.EvoloopAssistant.open(mode || 'size-fit', product)
      }
    }

    loadWidget()
    if (findBtn) {
      findBtn.addEventListener('click', function () {
        openAssistant('size-fit')
      })
    }
  }

  onReady(function () {
    initVariantPicker()
    initGallery()
    initRecommendations()
    initAssistant()
  })
})()
