// @ts-nocheck — 静态诊断探针（真机 JS 分层定位用，排障后移除）
window.__probeOk('3 external module <script type=module>: OK')
fetch('/api/diag', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    t: 'probe2',
    m: 'diag-probe page loaded',
    s: '',
    h: window.location.href,
    u: navigator.userAgent.slice(0, 140),
    ts: Date.now(),
  }),
})
  .then(function (r) {
    window.__probeOk('4 fetch to /api/diag: HTTP ' + r.status)
  })
  .catch(function (e) {
    window.__probeOk('4 fetch FAILED: ' + e)
  })
