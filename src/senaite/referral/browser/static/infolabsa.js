/* eslint-disable no-console */
(function () {
  "use strict";

  // === ÁMBITO: SOLO LISTADO DE MUESTRAS ===
  function isSamplesContext() {
    try {
      var p = (location && location.pathname) || "";
      // /samples o algo tipo .../samples?...
      if (/\/samples(?:[/?#]|$)/i.test(p)) return true;
    } catch (e) {}
    return false;
  }

  // Tabla del listado de muestras: detectamos por selectores + cabeceras típicas
  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    "table.table",
    ".listing-app table",
    ".app-listing table"
  ];

  var SAMPLES_HEADER_HINTS = [
    "id de muestra",
    "id muestra",
    "sample id",
    "paciente",
    "mrn",
    "creado por",
    "fecha de muestreo",
    "estado",
    "progreso"
  ];

  function isSamplesTable(tbl) {
    if (!tbl) return false;
    // cabeceras
    try {
      var ths = tbl.querySelectorAll("thead th, thead td");
      var text = Array.prototype.map.call(ths, function (th) {
        return (th.innerText || th.textContent || "").trim().toLowerCase();
      }).join(" | ");
      var hits = 0;
      SAMPLES_HEADER_HINTS.forEach(function (k) {
        if (text.indexOf(k) > -1) hits++;
      });
      if (hits >= 2) return true; // con 2 hints ya es buen indicador
    } catch (e) {}
    return false;
  }

  function isDebug() {
    try {
      return window && window.localStorage && localStorage.getItem("infolabsa.debug") === "1";
    } catch (e) {
      return false;
    }
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

  // === Marcado de fila ===
  function markRow(tr) {
    if (!tr) return;
    if (!tr.classList.contains("row-flag-alert")) tr.classList.add("row-flag-alert");
    if (tr.getAttribute("data-row-alert") !== "1") tr.setAttribute("data-row-alert", "1");
  }

  // Obtenemos el UID (ID de muestra) desde atributos o enlace de la fila
  function getSampleUIDFromRow(tr) {
    if (!tr) return null;
    var attrCandidates = ["data-uid","data-sample-uid","data-uid-sample","data-sampleuid","data-uid"];
    for (var i = 0; i < attrCandidates.length; i++) {
      var v = tr.getAttribute(attrCandidates[i]);
      if (v) return v;
    }
    try {
      var firstLink = tr.querySelector("td a[href]");
      if (firstLink) {
        var href = firstLink.getAttribute("href") || "";
        var parts = href.split(/[\/#?]/).filter(Boolean);
        if (parts.length) return parts[parts.length - 1];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function hasHelper() {
    return typeof window.infolabsaGetOorSamples === "function";
  }
  function toSet(x) {
    if (!x) return new Set();
    if (x instanceof Set) return x;
    if (Array.isArray(x)) return new Set(x);
    try { return new Set(Object.values(x)); }
    catch (e) { return new Set(); }
  }

  // === PROCESADO EXCLUSIVO DEL LISTADO DE MUESTRAS ===
  function processSamplesTable(tbl) {
    if (!tbl) return;
    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;

    var rows = Array.prototype.slice.call(tbody.rows || []);
    if (rows.length === 0) return;

    // No usamos heurísticas de texto/iconos para evitar pintar el detalle de analitos.
    // Solo marcamos con respuesta del helper.
    if (!hasHelper()) {
      log("helper ausente: no se marcarán filas (evitar falsos positivos)");
      return;
    }

    var uidMap = new Map();
    rows.forEach(function (tr) {
      // Evitar reprocesar
      if (tr.getAttribute("data-infolabsa-processed") === "1") return;
      var uid = getSampleUIDFromRow(tr);
      if (!uid) return;
      if (!uidMap.has(uid)) uidMap.set(uid, []);
      uidMap.get(uid).push(tr);
    });

    var uids = Array.from(uidMap.keys());
    if (uids.length === 0) return;

    log("consultando helper con", uids.length, "uids (listado de muestras)");
    var t0 = Date.now();

    window.infolabsaGetOorSamples(uids)
      .then(function (result) {
        var oorSet = toSet(result);
        var resolved = 0, flagged = 0;
        uids.forEach(function (uid) {
          var trs = uidMap.get(uid) || [];
          var isOOR = oorSet.has(uid);
          trs.forEach(function (tr) {
            if (isOOR) {
              markRow(tr);  // <- aquí marcamos; el CSS pondrá fondo rojo + borde
              flagged++;
            }
            tr.setAttribute("data-infolabsa-processed", "1");
            resolved++;
          });
        });
        log("helper OK: resueltas", resolved, "marcadas", flagged, "en", (Date.now() - t0) + "ms");
      })
      .catch(function (err) {
        log("helper error", err);
      });
  }

  var scanAll = debounce(function (root) {
    root = root || document;
    if (!isSamplesContext()) {
      // fuera de /samples no hacemos nada
      return;
    }
    var totalTables = 0, processed = 0;
    TABLE_SELECTORS.forEach(function (sel) {
      var tables = root.querySelectorAll(sel);
      totalTables += tables.length;
      Array.prototype.forEach.call(tables, function (tbl) {
        if (isSamplesTable(tbl)) {
          processed++;
          processSamplesTable(tbl);
        }
      });
    });
    log("scanAll(/samples): tablas encontradas=", totalTables, "tablas de muestras procesadas=", processed);
  }, 120);

  // Rescan “seguro” post-pintado
  function rescanSoon() {
    if (!isSamplesContext()) return;
    try { requestAnimationFrame(function(){ scanAll(document); }); }
    catch (e) { setTimeout(function(){ scanAll(document); }, 0); }
    setTimeout(function(){ scanAll(document); }, 300);
    setTimeout(function(){ scanAll(document); }, 800);
  }

  // Observer de mutaciones
  var observer = new MutationObserver(function (mutations) {
    if (!isSamplesContext()) return;
    var added = 0;
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.addedNodes && m.addedNodes.length) added += m.addedNodes.length;
    }
    if (added) {
      log("observer(/samples): nodos añadidos=", added);
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

  // Hook AJAX solo para llamadas del listado
  function hookAjaxComplete() {
    if (!window.jQuery) { log("ajax hook: jQuery no disponible"); return; }
    try {
      jQuery(document).ajaxComplete(function (_evt, _xhr, settings) {
        if (!isSamplesContext()) return;
        var url = (settings && settings.url) || "";
        // El listado de muestras dispara /samples/view/folderitems
        if (/\/samples\/view\/folderitems(\?|$)/.test(url) || /\/folderitems(\?|$)/.test(url)) {
          log("ajaxComplete(/samples):", url, "→ rescan");
          scanAll(document);
          rescanSoon();
        }
      });

      jQuery(document).on("listing:rendered", function () {
        if (!isSamplesContext()) return;
        log("evento listing:rendered(/samples) → rescan");
        scanAll(document);
        rescanSoon();
      });
      log("ajax hook: listo");
    } catch (e) { log("ajax hook: error", e); }
  }

  function init() {
    log("init");
    scanAll(document);
    rescanSoon();
    startObserver();
    hookAjaxComplete();
    window.__infolabsa__ = {
      rescan: function () { scanAll(document); rescanSoon(); },
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
