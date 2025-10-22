/* eslint-disable no-console */
(function () {
  "use strict";

  // ========== CONFIG ==========
  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    "table.table",
    ".listing-app table",
    ".app-listing table"
  ];

  var OOR_TEXT_PATTERNS = [
    "fuera de rango",
    "out of range",
    "oor",
    "range violation",
    "out-of-range"
  ];

  var OOR_ICON_HINTS = ["exclamation", "warning", "exclamation_red.svg", "warning.svg"];

  // Estados del listado de muestras a considerar
  var SAMPLE_REVIEW_STATES_TO_CHECK = [
    // Pendiente de verificar
    "to_be_verified",
    "por verificar",
    "pendiente de verificar",
    "pending verification",
    // Verificada
    "verified",
    "verificada",
    "verificadas",
    "verificado"
  ];

  // ========== UTILS ==========
  function isDebug() {
    try { return window && window.localStorage && localStorage.getItem("infolabsa.debug") === "1"; }
    catch (e) { return false; }
  }
  function log() {
    if (!isDebug()) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[infolabsa]");
    console.log.apply(console, args);
  }
  function debounce(fn, wait) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  // Solo actuamos en el LISTADO de muestras (no en detalle, no en otras vistas)
  function isSamplesListPage() {
    try {
      var p = location.pathname || "";
      // /.../samples  (termina en /samples, admitimos /samples/ y querystring)
      return /\/samples\/?(?:[?#]|$)/.test(p);
    } catch (e) { return false; }
  }

  function markRow(tr) {
    if (!tr) return;
    if (!tr.classList.contains("row-flag-alert")) tr.classList.add("row-flag-alert");
    if (tr.getAttribute("data-row-alert") !== "1") tr.setAttribute("data-row-alert", "1");
    // flag interno para no reprocesar
    tr.setAttribute("data-infolabsa-processed", "1");
  }

  function getSampleUIDFromRow(tr) {
    if (!tr) return null;
    var attrs = ["data-uid","data-sample-uid","data-uid-sample","data-sampleuid","data-uid"];
    for (var i = 0; i < attrs.length; i++) {
      var v = tr.getAttribute(attrs[i]);
      if (v) return v;
    }
    try {
      var a = tr.querySelector("td a[href]");
      if (a) {
        var href = a.getAttribute("href") || "";
        var parts = href.split(/[\/#?]/).filter(Boolean);
        if (parts.length) return parts[parts.length - 1];
      }
    } catch (e) {}
    return null;
  }

  function rowLooksOOR(tr) {
    if (!tr) return false;
    if (tr.classList.contains("row-flag-alert") || tr.getAttribute("data-row-alert") === "1") return true;
    if (tr.getAttribute("data-has-oor") === "1" || tr.querySelector('[data-oor="1"]')) return true;

    // Heurística por iconos incrustados en la MISMA fila del listado
    var imgs = tr.querySelectorAll("img, svg, use");
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      var src = (el.getAttribute("src") || el.getAttribute("href") || "").toLowerCase();
      var alt = (el.getAttribute("alt") || el.getAttribute("title") || "").toLowerCase();
      if (OOR_ICON_HINTS.some(function (k) { return src.indexOf(k) > -1 || alt.indexOf(k) > -1; })) return true;
    }

    // Heurística por texto en la MISMA fila
    var text = (tr.innerText || "").toLowerCase();
    if (OOR_TEXT_PATTERNS.some(function (k) { return text.indexOf(k) > -1; })) return true;

    return false;
  }

  function hasHelper() {
    return typeof window.infolabsaGetOorSamples === "function";
  }

  function toSet(x) {
    if (!x) return new Set();
    if (x instanceof Set) return x;
    if (Array.isArray(x)) return new Set(x);
    try { return new Set(Object.values(x)); } catch (e) { return new Set(); }
  }

  // ========== Núcleo ==========
  function processTable(tbl) {
    if (!tbl) return;
    if (!isSamplesListPage()) return; // 🚫 Nunca tocar otras vistas (incluye detalle de muestra)
    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;

    var rows = Array.prototype.slice.call(tbody.rows || []);
    if (rows.length === 0) return;

    var pre = Date.now();
    var markedByHeuristics = 0;

    // 1) Heurística local (no hace llamadas al servidor)
    rows.forEach(function (tr) {
      if (rowLooksOOR(tr)) {
        markRow(tr);
        markedByHeuristics++;
      }
    });
    log("processTable: filas=", rows.length, "marcadas x heurística=", markedByHeuristics);

    // 2) Helper del backend si existe (batch → cero impacto)
    if (hasHelper()) {
      var unresolved = rows.filter(function (tr) {
        return tr.getAttribute("data-infolabsa-processed") !== "1";
      });

      if (unresolved.length === 0) return;

      var uidMap = new Map();
      unresolved.forEach(function (tr) {
        // Solo tiene sentido consultar si el estado es relevante (pendiente/verificada)
        var txt = (tr.innerText || "").toLowerCase();
        var matchState = SAMPLE_REVIEW_STATES_TO_CHECK.some(function (k) { return txt.indexOf(k) > -1; });
        if (!matchState) return;

        var uid = getSampleUIDFromRow(tr);
        if (uid) {
          if (!uidMap.has(uid)) uidMap.set(uid, []);
          uidMap.get(uid).push(tr);
        }
      });

      var uids = Array.from(uidMap.keys());
      if (!uids.length) return;

      log("consultando helper con", uids.length, "uids");
      window.infolabsaGetOorSamples(uids)
        .then(function (result) {
          var oorSet = toSet(result);
          uids.forEach(function (uid) {
            var trs = uidMap.get(uid) || [];
            var isOOR = oorSet.has(uid);
            trs.forEach(function (tr) {
              if (isOOR) markRow(tr);
              else tr.setAttribute("data-infolabsa-processed", "1");
            });
          });
          log("helper: completado en", (Date.now() - pre) + "ms");
        })
        .catch(function (err) { log("helper error", err); });
    }

    // 3) 🚫 IMPORTANTE: sin helper NO hacemos ninguna llamada por-fila.
    //    Esto evita los POST /table_lab_analyses/folderitems que te estaban
    //    causando latencia y errores. Si no hay helper, el script se queda
    //    con heurísticas locales (sin tocar el detalle de analitos).
  }

  var scanAll = debounce(function (root) {
    root = root || document;
    if (!isSamplesListPage()) return; // seguridad extra
    var totalTables = 0;
    TABLE_SELECTORS.forEach(function (sel) {
      var tables = root.querySelectorAll(sel);
      totalTables += tables.length;
      Array.prototype.forEach.call(tables, processTable);
    });
    log("scanAll: tablas encontradas=", totalTables);
  }, 120);

  // Rescan “seguro” post-pintado
  function rescanSoon() {
    if (!isSamplesListPage()) return;
    try { requestAnimationFrame(function(){ scanAll(document); }); }
    catch (e) { setTimeout(function(){ scanAll(document); }, 0); }
    setTimeout(function(){ scanAll(document); }, 250);
    setTimeout(function(){ scanAll(document); }, 700);
  }

  var observer = new MutationObserver(function (mutations) {
    if (!isSamplesListPage()) return;
    var added = 0;
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.addedNodes && m.addedNodes.length) added += m.addedNodes.length;
    }
    if (added) {
      log("observer: nodos añadidos=", added);
      scanAll(document);
      rescanSoon();
    }
  });

  function startObserver() {
    try {
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
      log("observer: iniciado");
    } catch (e) { log("observer: fallo al iniciar", e); }
  }

  function hookAjaxComplete() {
    if (!window.jQuery) { log("ajax hook: jQuery no disponible"); return; }
    try {
      jQuery(document).ajaxComplete(function (_evt, _xhr, settings) {
        var url = (settings && settings.url) || "";
        // Solo re-escaneamos cuando se renderiza el listado (folderitems) Y estamos en /samples
        if (isSamplesListPage() && /\/folderitems(\?|$)/.test(url)) {
          log("ajaxComplete: folderitems @samples → rescan");
          scanAll(document);
          rescanSoon();
        }
      });
      jQuery(document).on("listing:rendered", function () {
        if (!isSamplesListPage()) return;
        log("evento listing:rendered → rescan");
        scanAll(document);
        rescanSoon();
      });
      log("ajax hook: listo");
    } catch (e) { log("ajax hook: error", e); }
  }

  function init() {
    if (!(document && document.body)) return;
    if (!isSamplesListPage()) { log("init: fuera de /samples, noop"); return; }
    log("init @samples");
    scanAll(document);
    rescanSoon();
    startObserver();
    hookAjaxComplete();
    window.__infolabsa__ = {
      rescan: function () { if (isSamplesListPage()) { scanAll(document); rescanSoon(); } },
      _debug: { TABLE_SELECTORS: TABLE_SELECTORS }
    };
    log("__infolabsa__ listo");
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 0);
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
