/* eslint-disable no-console */
/*!
 * infolabsa.js — versión segura SIN FETCH (optimizada rendimiento) + PARCHE DateTimeWidget
 *
 * Nota clave: este parche intenta aplicarse lo más temprano posible y
 * además inyecta una salvaguarda en DOMContentLoaded para asegurar que
 * DateTimeWidget.prototype.autofill_now esté parcheado ANTES de que los
 * inicializadores de datetimewidget.js lo invoquen.
 */

/* ===================================================================
   PARCHE ROBUSTO para DateTimeWidget.autofill_now
   - Evita "Cannot read properties of undefined (reading 'length')"
   - Normaliza colecciones/inputs antes de invocar al original
   - Fallback seguro si el original no existe o falla
   - Salvaguarda en DOMContentLoaded para adelantarnos a otros handlers
   =================================================================== */
(function () {
  'use strict';

  var PATCH_FLAG = '__infolabsa_dtwidget_patched__';

  function isArrayLike(x) { return !!x && typeof x.length === 'number'; }
  function toArray(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    if (window.jQuery && x instanceof window.jQuery) return x.get();
    if (isArrayLike(x)) return Array.prototype.slice.call(x);
    return [x];
  }
  function setVal(el, val) {
    try {
      if (!el) return;
      if (window.jQuery && (el instanceof window.jQuery)) { el.val(val).trigger('change'); return; }
      if (isArrayLike(el)) { for (var i=0;i<el.length;i++) setVal(el[i], val); return; }
      if (el.nodeType === 1 && 'value' in el) {
        el.value = val;
        try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (_e) {}
      }
    } catch (_eSet) {}
  }
  function fmtISO(d){ var y=d.getFullYear(),m=('0'+(d.getMonth()+1)).slice(-2),da=('0'+d.getDate()).slice(-2); return y+'-'+m+'-'+da; }
  function fmtHM(d){ var h=('0'+d.getHours()).slice(-2),m=('0'+d.getMinutes()).slice(-2); return h+':'+m; }

  function applyPatchOn(DateTimeWidget) {
    try {
      if (!DateTimeWidget || !DateTimeWidget.prototype) return;
      if (DateTimeWidget.prototype[PATCH_FLAG]) return; // ya parcheado

      var originalAuto = DateTimeWidget.prototype.autofill_now;

      DateTimeWidget.prototype.autofill_now = function () {
        try {
          // Normaliza propiedades típicas usadas por estos widgets
          this._dateFields = toArray(this._dateFields || this.$date || this.date || this.inputDate || this.inputsDate || this.input || this.$inputs);
          this._timeFields = toArray(this._timeFields || this.$time || this.time || this.inputTime || this.inputsTime);

          // Asegura que existan colecciones (aunque vacías)
          if (!isArrayLike(this._dateFields)) this._dateFields = toArray(this._dateFields);
          if (!isArrayLike(this._timeFields)) this._timeFields = toArray(this._timeFields);

          // Intenta el original primero
          if (typeof originalAuto === 'function') {
            try { return originalAuto.apply(this, arguments); } catch (_errOriginal) { /* fallback abajo */ }
          }

          // Fallback: poner "ahora" de forma segura
          var now = new Date();
          if (this._dateFields.length) setVal(this._dateFields, fmtISO(now));
          if (this._timeFields.length) setVal(this._timeFields, fmtHM(now));
          return true;
        } catch (_err) {
          return false; // silenciar completamente
        }
      };

      DateTimeWidget.prototype[PATCH_FLAG] = true;
    } catch (_e) {}
  }

  // 1) Parche inmediato si ya existe
  if (window.DateTimeWidget) applyPatchOn(window.DateTimeWidget);

  // 2) Intercepta el setter para parchear en cuanto lo definan
  try {
    var _dtw = window.DateTimeWidget;
    Object.defineProperty(window, 'DateTimeWidget', {
      configurable: true,
      enumerable: true,
      get: function () { return _dtw; },
      set: function (v) { _dtw = v; try { applyPatchOn(v); } catch (_e) {} }
    });
  } catch (_edef) {
    // 3) Fallback: poll rápido durante un pequeño lapso
    var t = setInterval(function () {
      if (window.DateTimeWidget) { try { applyPatchOn(window.DateTimeWidget); } catch (_e) {} clearInterval(t); }
    }, 20);
    setTimeout(function () { try { clearInterval(t); } catch (_e) {} }, 4000);
  }

  // 4) Salvaguarda: envuelve addEventListener para DOMContentLoaded.
  //    Antes de ejecutar cualquier handler de DOMContentLoaded que se registre DESPUÉS de este script,
  //    nos aseguramos de que el parche esté aplicado.
  (function patchDOMContentLoadedOnce(){
    if (window.__infolabsa_dcl_patched__) return;
    window.__infolabsa_dcl_patched__ = true;

    var origAdd = document.addEventListener;
    document.addEventListener = function(type, listener, opts){
      if (type === 'DOMContentLoaded' && typeof listener === 'function') {
        var wrapped = function(ev){
          try { if (window.DateTimeWidget) applyPatchOn(window.DateTimeWidget); } catch (_e) {}
          return listener.call(this, ev);
        };
        return origAdd.call(document, type, wrapped, opts);
      }
      return origAdd.call(document, type, listener, opts);
    };

    // Si el DOM ya está listo, ejecuta el parche inmediatamente
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
      try { if (window.DateTimeWidget) applyPatchOn(window.DateTimeWidget); } catch (_e) {}
    } else {
      // Antes de dispararse el verdadero DOMContentLoaded, asegura el parche
      origAdd.call(document, 'DOMContentLoaded', function(){
        try { if (window.DateTimeWidget) applyPatchOn(window.DateTimeWidget); } catch (_e) {}
      }, { once: true });
    }
  })();

})();
 
// ===================================================================
// CÓDIGO ORIGINAL DE INFOLABSA (sin cambios)
// ===================================================================
(function () {
  "use strict";

  // ====== Etapa 0: entorno seguro ======
  try {
    if (typeof window === "undefined" || !window.document) return;
  } catch (_e) { return; }

  // ====== Etapa 1: "matar" versión anterior una sola vez ======
  var MIGRATION_TAG = "v2.0-autodisable-2025-10-22";
  try {
    var ls = window.localStorage;
    var alreadyMigrated = ls.getItem("infolabsa.migrated") === MIGRATION_TAG;

    if (!alreadyMigrated) {
      try {
        if (window.__infolabsa__ && typeof window.__infolabsa__.stop === "function") {
          window.__infolabsa__.stop();
        }
      } catch (_eStop) {}

      try { ls.removeItem("infolabsa.enabled"); } catch (_e1) {}
      try { ls.setItem("infolabsa.migrated", MIGRATION_TAG); } catch (_e2) {}

      var reloadedOnce = ls.getItem("infolabsa.reloadedOnce") === "1";
      if (!reloadedOnce) {
        try { ls.setItem("infolabsa.reloadedOnce", "1"); } catch (_e3) {}
        try { location.reload(); return; } catch (_e4) {}
      }
    }
  } catch (_eMig) {}

  // ====== Etapa 2: API pública SIEMPRE disponible ======
  function setLS(key, val){ try { localStorage.setItem(key, val); } catch(_e){} }
  function delLS(key){ try { localStorage.removeItem(key); } catch(_e){} }

  window.__infolabsa__ = {
    enable: function () { setLS("infolabsa.enabled","1"); try{ location.reload(); }catch(_e){} },
    disable: function () { delLS("infolabsa.enabled");  try{ location.reload(); }catch(_e){} },
    rescan: function () { /* se redefine al inicializar si está activado */ },
    stop: function () { /* no-op en versión segura */ }
  };

  // ====== Etapa 3: si NO está activado, salimos (no-op) ======
  var enabled = false;
  try { enabled = localStorage.getItem("infolabsa.enabled") === "1"; } catch (_e) { enabled = false; }
  if (!enabled) return;

  // ====== Lógica pasiva (solo DOM, sin fetch) ======
  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    ".listing-app table",
    ".app-listing table"
  ];

  var OOR_TEXT_PATTERNS = [
    "fuera de rango", "out of range", "out-of-range", "oor",
    "fuera del rango", "range violation", "range_violation",
    "alerta crítica", "crítico", "critical", "panic", "panic high", "panic low"
  ];

  var OOR_ICON_HINTS = [
    "exclamation", "warning", "alert", "triangle",
    "exclamation_red.svg", "warning.svg", "icon-alert", "fa-exclamation"
  ];

  var OOR_CLASS_HINTS = [
    "fr-alert", "al-critical", "al-delta", "out-of-range", "range-violation",
    "state-oor", "state-outofrange", "is-oor", "has-oor"
  ];

  var SAMPLE_REVIEW_STATES_TO_CHECK = [
    "to_be_verified", "por verificar", "pendiente de verificar",
    "pending verification", "verified", "verificada", "verificado"
  ];

  function isDebug(){ try { return localStorage.getItem("infolabsa.debug") === "1"; } catch(_e){ return false; } }
  function log(){ if(!isDebug()) return; try { var a=[].slice.call(arguments); a.unshift("[infolabsa]"); console.log.apply(console,a); } catch(_e){} }
  function safe(fn){ try { fn(); } catch(e){ log("safe err", e); } }
  function isSamplesListPage(){ try { return /\/samples\/?(?:[?#]|$)/.test(location.pathname || ""); } catch(_e){ return false; } }

  function markRow(tr){
    try{
      if (!tr) return;
      if (tr.classList.contains("row-flag-alert")) return;
      tr.classList.add("row-flag-alert");
      tr.setAttribute("data-row-alert","1");
      tr.setAttribute("data-infolabsa-processed","1");

      var td = tr.querySelector('td') || tr;
      if (td && !td.querySelector('.oob-flag[data-oor="1"]')) {
        var span = document.createElement('span');
        span.className = 'oob-flag';
        span.setAttribute('data-oor', '1');
        span.style.display = 'none';
        td.appendChild(span);
      }

      var catName = tr.getAttribute('category');
      if (catName) {
        var catRow = tr.closest('table')?.querySelector('tr.categoryrow[category="'+CSS.escape(catName)+'"]');
        if (catRow) {
          catRow.classList.add('row-flag-alert');
          catRow.setAttribute('data-row-alert','1');
        }
      }
    } catch(e){ log("markRow err", e); }
  }

  function rowStateRelevant(tr){
    try{
      var text = (tr.innerText || "").toLowerCase();
      for (var i=0;i<SAMPLE_REVIEW_STATES_TO_CHECK.length;i++){
        if (text.indexOf(SAMPLE_REVIEW_STATES_TO_CHECK[i])>-1) return true;
      }
    } catch(_e){}
    return false;
  }

  function rowLooksOOR(tr){
    try{
      if (tr.classList.contains("row-flag-alert") || tr.getAttribute("data-row-alert")==="1") return true;
      if (tr.getAttribute("data-has-oor")==="1" || tr.querySelector('[data-oor="1"]')) return true;

      for (var c=0; c<OOR_CLASS_HINTS.length; c++){
        var cls = OOR_CLASS_HINTS[c];
        if (tr.classList.contains(cls)) return true;
        if (tr.querySelector("td."+cls+", td ."+cls+' , td [class*="'+cls+'"]')) return true;
      }

      var imgs = tr.querySelectorAll("td img, td svg, td use");
      for (var i=0;i<imgs.length;i++){
        var el = imgs[i];
        var src = (el.getAttribute("src") || el.getAttribute("href") || "").toLowerCase();
        var alt = (el.getAttribute("alt") || el.getAttribute("title") || "").toLowerCase();
        for (var j=0;j<OOR_ICON_HINTS.length;j++){
          var k = OOR_ICON_HINTS[j];
          if ((src && src.indexOf(k)>-1) || (alt && alt.indexOf(k)>-1)) return true;
        }
      }

      var cells = tr.querySelectorAll("td");
      for (var t=0;t<OOR_TEXT_PATTERNS.length;t++){
        var pat = OOR_TEXT_PATTERNS[t];
        for (var k=0;k<cells.length;k++){
          var tx = (cells[k].innerText || "").toLowerCase();
          if (tx.indexOf(pat)>-1) return true;
        }
      }

      var likely = tr.querySelector('td[class*="state"], td[class*="status"], td[class*="alert"], td[class*="range"]');
      if (likely){
        var ltxt = (likely.innerText || "").toLowerCase();
        for (var t2=0;t2<OOR_TEXT_PATTERNS.length;t2++){
          if (ltxt.indexOf(OOR_TEXT_PATTERNS[t2])>-1) return true;
        }
        if (likely.querySelector('[data-oor="1"], .out-of-range, .fr-alert, .al-critical')) return true;
      }
    } catch(e){ log("rowLooksOOR err", e); }
    return false;
  }

  function processTable(tbl){
    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;
    var rows = Array.prototype.slice.call(tbody.rows || []);
    var marked = 0;
    for (var i=0;i<rows.length;i++){
      var tr = rows[i];
      if (tr.getAttribute("data-infolabsa-processed")==="1") continue;
      if (!rowStateRelevant(tr)) { tr.setAttribute("data-infolabsa-processed","1"); continue; }
      if (rowLooksOOR(tr)) { markRow(tr); marked++; }
      else { tr.setAttribute("data-infolabsa-processed","1"); }
    }
    log("processTable: filas=", rows.length, "marcadas=", marked);
  }

  function scanAll(root){
    if (!isSamplesListPage()) return;
    root = root || document;
    var totalTables = 0;
    for (var s=0;s<TABLE_SELECTORS.length;s++){
      var sel = TABLE_SELECTORS[s];
      var tables = root.querySelectorAll(sel);
      totalTables += tables.length;
      for (var i=0;i<tables.length;i++){
        (function(tbl){ safe(function(){ processTable(tbl); }); })(tables[i]);
      }
    }
    log("scanAll: tablas=", totalTables);
  }

  function init(){
    if (!(document && document.body)) return;
    if (!isSamplesListPage()) { log("init: fuera de /samples (noop)"); return; }
    log("init @samples (enabled, sin fetch; observers mínimos)");
    setTimeout(function(){ safe(function(){ scanAll(document); }); }, 100);

    window.__infolabsa__.rescan = function(){ if (isSamplesListPage()) scanAll(document); };

    document.addEventListener('listing:after-render', function(e){
      safe(function(){ scanAll(e?.target || document); });
    }, true);

    var table = document.querySelector('table');
    var tbody = table?.tBodies?.[0] || table?.querySelector?.('tbody');
    if (tbody) {
      try {
        var mo = new MutationObserver(function(muts){
          if (muts.some(function(m){ return (m.addedNodes?.length || 0) > 0; })) {
            clearTimeout(mo._t);
            mo._t = setTimeout(function(){ safe(function(){ scanAll(document); }); }, 60);
          }
        });
        mo.observe(tbody, { childList: true, subtree: true });
      } catch (err) { log('observer tbody error', err); }
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(function(){ safe(init); }, 0);
  } else {
    document.addEventListener("DOMContentLoaded", function(){ safe(init); });
  }
})();

/* ====== Vista de muestra (tabla de análisis): marca filas si ya hay icono OOR ====== */
document.addEventListener('DOMContentLoaded', function () {
  var rows = document.querySelectorAll('table.contentstable tr.contentrow.parent');
  rows.forEach(function(tr){
    var outOfRangeIcon = tr.querySelector('img[title="Result out of range"], img[src*="exclamation_red.svg"]');
    if (outOfRangeIcon) {
      if (!tr.classList.contains('row-flag-alert')) {
        tr.classList.add('row-flag-alert');
        tr.setAttribute('data-row-alert', '1');
      }
      var catName = tr.getAttribute('category');
      if (catName) {
        var catRow = document.querySelector('tr.categoryrow[category="'+catName+'"]');
        if (catRow) catRow.classList.add('row-flag-alert');
      }
    }
  });
});

/* ====== Highlighter por iconos/texto en cualquier listing renderizado ====== */
(function () {
  var OOR_IMG_SEL = 'img[src*="exclamation_red.svg"], img[title*="out of range" i]';

  function markRow(tr) {
    if (!tr || tr.dataset.oorApplied === '1') return;
    tr.classList.add('row-flag-alert');
    tr.setAttribute('data-row-alert', '1');

    var td = tr.querySelector('td') || tr;
    if (td && !td.querySelector('.oob-flag[data-oor="1"]')) {
      var span = document.createElement('span');
      span.className = 'oob-flag';
      span.setAttribute('data-oor', '1');
      span.style.display = 'none';
      td.appendChild(span);
    }
    tr.dataset.oorApplied = '1';
  }

  function markFromIcons(root) {
    root = root || document;
    var imgs = root.querySelectorAll(OOR_IMG_SEL);
    var count = 0;
    imgs.forEach(function(img){
      var tr = img.closest('tr');
      if (tr) {
        markRow(tr);
        count++;
        var catName = tr.getAttribute('category');
        if (catName) {
          var catRow = tr.closest('table')?.querySelector('tr.categoryrow[category="'+CSS.escape(catName)+'"]');
          if (catRow) markRow(catRow);
        }
      }
    });
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[OOR] Íconos encontrados:', imgs.length, ' | Filas marcadas:', count);
    }
  }

  document.addEventListener('DOMContentLoaded', function(){ markFromIcons(); });
  document.addEventListener('listing:after-render', function(e){ markFromIcons(e.target || document); }, true);

  try {
    var target = document && document.body;
    if (target && target.nodeType === 1) {
      var mo = new MutationObserver(function(muts){
        var doit = false;
        for (var i=0;i<muts.length && !doit;i++){
          var m = muts[i];
          if (!m.addedNodes) continue;
          for (var j=0;j<m.addedNodes.length;j++){
            var n = m.addedNodes[j];
            if (n.nodeType === 1 && (n.matches?.('tr, table, tbody') || n.querySelector?.(OOR_IMG_SEL))) {
              doit = true; break;
            }
          }
        }
        if (doit) {
          clearTimeout(mo._t);
          mo._t = setTimeout(function(){ markFromIcons(document); }, 50);
        }
      });
      mo.observe(target, { childList: true, subtree: true });
    }
  } catch (err) {
    if (console && console.debug) console.debug('[OOR] Fallback observer error:', err);
  }
})();
