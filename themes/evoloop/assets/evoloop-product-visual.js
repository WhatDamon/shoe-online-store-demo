// @ts-nocheck — vanilla theme asset, not part of the app TS project
/**
 * Evoloop product visual (Horizon build) — vanilla port of the Next.js
 * ProductVisual (src/components/shop/product-visual.tsx). Deterministic
 * inline SVG built purely with DOM APIs (no innerHTML → no markup
 * injection surface from merchant metafields). Three views side/sole/detail,
 * patterns lattice | wave | honeycomb.
 *
 * Mounts any [data-evo-visual] root: with a data-view attribute it renders
 * that single view; without one it renders the PDP gallery (Side/Sole/Detail
 * tabs). Reads data-pattern / data-density / data-palette (JSON array) /
 * data-accent / data-name. Every value falls back to an Evoloop default.
 */
(() => {
  

  var SVGNS = 'http://www.w3.org/2000/svg'
  var DEFAULTS = {
    palette: ['#f3f1ea', '#9ca3af'],
    accent: '#0f766e',
    density: 0.75,
    pattern: 'lattice',
  }

  var uid = 0

  function el(name, attrs) {
    var node = document.createElementNS(SVGNS, name)
    if (attrs) {
      for (var key in attrs) {
        if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key])
      }
    }
    return node
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n))
  }

  function cellSize(base, density, view) {
    var scale = view === 'detail' ? 1.9 : view === 'sole' ? 1.15 : 1
    return clamp(Math.round((base * scale * 0.75) / density), 5, 48)
  }

  function hexPath(cx, cy, r) {
    var pts = []
    for (var k = 0; k < 6; k++) {
      var rad = ((-90 + k * 60) * Math.PI) / 180
      pts.push((cx + r * Math.cos(rad)).toFixed(2) + ',' + (cy + r * Math.sin(rad)).toFixed(2))
    }
    return 'M' + pts.join('L') + 'Z'
  }

  function patternNode(id, pattern, palette, accent, S) {
    var p1 = palette[1]
    var pat
    var i
    if (pattern === 'honeycomb') {
      // True hexagonal tiling (pointy-top): centers (0,0)/(√3R,0)/(√3R/2,1.5R)/(0,3R)/(√3R,3R)
      var R = S / (2 * Math.sqrt(3))
      var colX = Math.sqrt(3) * R
      var rowY = 1.5 * R
      pat = el('pattern', { id: id, width: colX, height: rowY * 2, patternUnits: 'userSpaceOnUse' })
      var centers = [
        [0, 0],
        [colX, 0],
        [colX / 2, rowY],
        [0, rowY * 2],
        [colX, rowY * 2],
      ]
      for (i = 0; i < centers.length; i++) {
        pat.appendChild(el('path', { d: hexPath(centers[i][0], centers[i][1], R), fill: 'none', stroke: p1, 'stroke-width': 0.6, opacity: 0.9 }))
      }
      return pat
    }
    if (pattern === 'wave') {
      var a = S * 0.2
      var y0 = S * 0.62
      function wavePath(yy, flip) {
        return flip
          ? 'M0 ' + (yy + a) + ' Q ' + S / 4 + ' ' + (yy - a) + ' ' + S / 2 + ' ' + (yy + a) + ' T ' + S + ' ' + (yy + a)
          : 'M0 ' + (yy - a) + ' Q ' + S / 4 + ' ' + (yy + a) + ' ' + S / 2 + ' ' + (yy - a) + ' T ' + S + ' ' + (yy - a)
      }
      pat = el('pattern', { id: id, width: S, height: S, patternUnits: 'userSpaceOnUse' })
      pat.appendChild(el('path', { d: wavePath(y0, false), fill: 'none', stroke: p1, 'stroke-width': 0.7, opacity: 0.85 }))
      pat.appendChild(el('path', { d: wavePath(y0 - S / 2, true), fill: 'none', stroke: accent, 'stroke-width': 0.5, opacity: 0.55 }))
      return pat
    }
    // lattice: crossed diagonals + accent dot
    pat = el('pattern', { id: id, width: S, height: S, patternUnits: 'userSpaceOnUse' })
    pat.appendChild(el('line', { x1: S, y1: 0, x2: 0, y2: S, stroke: p1, 'stroke-width': 0.7, opacity: 0.9 }))
    pat.appendChild(el('line', { x1: 0, y1: 0, x2: S, y2: S, stroke: p1, 'stroke-width': 0.7, opacity: 0.9 }))
    pat.appendChild(el('circle', { cx: 0, cy: 0, r: S * 0.08, fill: accent, opacity: 0.85 }))
    return pat
  }

  var SIDE_UPPER =
    'M38 100 C34 78 44 58 62 50 C84 40 108 44 120 58 C130 70 148 78 168 82 C186 86 202 84 212 74 ' +
    'C220 66 224 56 224 48 C226 68 226 84 220 96 L214 100 L40 100 Z'
  var SOLE_OUTER =
    'M118 26 C 62 26 36 50 36 76 C 36 104 72 126 124 126 C 178 126 210 108 210 82 C 210 58 190 46 172 42 C 158 39 152 26 118 26 Z'

  function svgNode(view, cfg) {
    var S = cellSize(view === 'detail' ? 16 : 13, cfg.density, view)
    var id = 'evopv' + (++uid).toString(36) + '_' + view
    var vb = view === 'detail' ? '0 0 160 160' : '0 0 240 150'
    var svg = el('svg', { viewBox: vb, role: 'img', class: 'evo-visual__svg', focusable: 'false' })
    svg.setAttribute('aria-label', cfg.name + ' — printed shoe')
    svg.appendChild(el('defs', null)).appendChild(patternNode(id, cfg.pattern, cfg.palette, cfg.accent, S))
    var g = el('g', null)
    var fill = 'url(#' + id + ')'

    if (view === 'side') {
      g.appendChild(el('path', { d: SIDE_UPPER, fill: cfg.palette[0] }))
      g.appendChild(el('path', { d: SIDE_UPPER, fill: fill }))
      g.appendChild(
        el('path', {
          d: 'M38 116 a14 14 0 0 1 14 -14 h146 a14 14 0 0 1 14 14 v8 a14 14 0 0 1 -14 14 h-146 a14 14 0 0 1 -14 -14 z',
          fill: cfg.accent,
          opacity: 0.9,
        }),
      )
      g.appendChild(
        el('path', { d: 'M38 116 a14 14 0 0 1 14 -14 h146 a14 14 0 0 1 14 14', fill: 'none', stroke: cfg.palette[1], 'stroke-width': 1.5 }),
      )
      g.appendChild(
        el('path', { d: 'M66 66 C 100 78 140 82 178 80', fill: 'none', stroke: cfg.accent, 'stroke-width': 3.5, 'stroke-linecap': 'round', opacity: 0.85 }),
      )
      g.appendChild(el('path', { d: 'M78 44 a5 5 0 1 1 0.1 0', fill: 'none', stroke: cfg.palette[1], 'stroke-width': 1 }))
    } else if (view === 'sole') {
      g.appendChild(el('path', { d: SOLE_OUTER, fill: cfg.palette[0] }))
      g.appendChild(el('path', { d: SOLE_OUTER, fill: fill }))
      g.appendChild(el('ellipse', { cx: 158, cy: 82, rx: 38, ry: 28, fill: cfg.accent, opacity: 0.85 }))
      g.appendChild(el('ellipse', { cx: 84, cy: 78, rx: 30, ry: 22, fill: cfg.accent, opacity: 0.6 }))
      g.appendChild(el('ellipse', { cx: 158, cy: 82, rx: 38, ry: 28, fill: 'none', stroke: cfg.palette[1], 'stroke-width': 1.2, opacity: 0.7 }))
      g.appendChild(el('ellipse', { cx: 84, cy: 78, rx: 30, ry: 22, fill: 'none', stroke: cfg.palette[1], 'stroke-width': 1, opacity: 0.6 }))
    } else {
      g.appendChild(el('rect', { x: 24, y: 24, width: 112, height: 112, rx: 14, fill: cfg.palette[0] }))
      g.appendChild(el('rect', { x: 24, y: 24, width: 112, height: 112, rx: 14, fill: fill }))
      g.appendChild(el('rect', { x: 24, y: 24, width: 112, height: 112, rx: 14, fill: 'none', stroke: cfg.palette[1], 'stroke-width': 2 }))
      g.appendChild(
        el('path', {
          d: SIDE_UPPER,
          fill: 'none',
          stroke: cfg.accent,
          'stroke-width': 1.4,
          opacity: 0.3,
          transform: 'translate(-44 -26) scale(0.5)',
        }),
      )
    }
    svg.appendChild(g)
    return svg
  }

  function cfgFrom(node) {
    var palette = DEFAULTS.palette
    try {
      var parsed = JSON.parse(node.getAttribute('data-palette') || '')
      if (Array.isArray(parsed) && parsed.length >= 2) palette = parsed
    } catch {
      /* keep defaults */
    }
    var density = parseFloat(node.getAttribute('data-density') || '')
    if (!isFinite(density)) density = DEFAULTS.density
    return {
      pattern: (node.getAttribute('data-pattern') || DEFAULTS.pattern).toLowerCase(),
      density: clamp(density, 0.5, 1),
      palette: palette,
      accent: node.getAttribute('data-accent') || DEFAULTS.accent,
      name: node.getAttribute('data-name') || '',
    }
  }

  var VIEW_LABELS = [
    { view: 'side', label: 'Side' },
    { view: 'sole', label: 'Sole' },
    { view: 'detail', label: 'Detail' },
  ]

  function renderSingle(node) {
    var view = node.getAttribute('data-view') || 'side'
    node.replaceChildren(svgNode(view, cfgFrom(node)))
  }

  function renderGallery(node) {
    var cfg = cfgFrom(node)
    var current = 'side'

    var canvas = document.createElement('div')
    canvas.className = 'evo-visual__canvas'

    var tabs = document.createElement('div')
    tabs.className = 'evo-visual__tabs'
    tabs.setAttribute('role', 'group')
    tabs.setAttribute('aria-label', 'Views')
    var buttons = {}
    VIEW_LABELS.forEach((v) => {
      var b = document.createElement('button')
      b.type = 'button'
      b.className = 'evo-visual__tab'
      b.textContent = v.label
      b.setAttribute('aria-label', 'Show ' + v.label.toLowerCase() + ' view')
      b.addEventListener('click', () => {
        current = v.view
        paint()
      })
      buttons[v.view] = b
      tabs.appendChild(b)
    })

    function paint() {
      canvas.replaceChildren(svgNode(current, cfg))
      VIEW_LABELS.forEach((v) => {
        buttons[v.view].setAttribute('aria-pressed', String(v.view === current))
        buttons[v.view].classList.toggle('is-active', v.view === current)
      })
    }

    node.replaceChildren(canvas, tabs)
    paint()
  }

  function mount(root) {
    var nodes = (root || document).querySelectorAll('[data-evo-visual]')
    Array.prototype.forEach.call(nodes, (node) => {
      if (node.getAttribute('data-view') === null) {
        renderGallery(node)
      } else {
        renderSingle(node)
      }
    })
  }

  // Theme asset exposes a global consumed by other theme scripts; this app's
  // TS lib window declaration does not know it.
  // @ts-ignore
  window.EvoloopVisual = { mount: mount }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mount(document)
    })
  } else {
    mount(document)
  }
})()
