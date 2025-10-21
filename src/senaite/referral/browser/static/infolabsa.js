/* eslint-disable no-console */
(function () {
  "use strict";

  // --- Configurable selectors: tablas de listados que usa SENAITE ---
  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    "table.table"
  ];

  // Palabras clave/heurística para detectar OOR en la fila (por si existen)
  var OOR_TEXT_PATTERNS = [
    "fuera de rango",
    "out of range",
    "oor",
    "range violation",
    "out-of-range"
  ];

  // Iconos comunes en SENAITE que podrían usarse como alerta
  var OOR_ICON_HINTS = [
    "exclamation", // exclamation_red.svg, etc.
    "warning"      // warning.svg
  ];

  // Debounce utilitario
  function debounce(fn, wait) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  // Log controlado
  function log() {
    if (window && window.localStorage && localStorage.getItem("infolabsa.debug") === "1") {
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[infolabsa]");
      console.log.apply(console, args);
    }
  }

  // Marca visual estándar (compatible con tu CSS)
  function markRow(tr) {
    if (!tr) return;
    if (!tr.classList.contains("row-flag-alert")) {
      tr.classList.add("row-flag-alert");
    }
    if (tr.getAttribute("data-row-alert") !== "1") {
      tr.setAttribute("data-row-alert", "1");
    }
  }

  // Intenta obtener el UID de muestra de la fila (mejor esfuerzo, no intrusivo)
  function getSampleUIDFromRow(tr) {
    if (!tr) return null;

    // 1) Atributos comunes que podrías añadir server-side
    var attrCandidates = [
      "data-uid",
      "data-sample-uid",
      "data-uid-sample",
      "data-sampleuid"
    ];
    for (var i = 0; i < attrCandidates.length; i++) {
      var v = tr.getAttribute(attrCandidates[i]);
      if (v) return v;
    }

    // 2) Enlaces en la primera columna que apunten a /clients/.../SAMPLEID
    try {
      var firstLink = tr.querySelector("td a[href]");
      if (firstLink) {
        var href = firstLink.getAttribute("href") || "";
        // Extrae la última parte del path como posible id/uid
        var parts = href.split(/[\/#?]/).filter(Boolean);
        if (parts.length) {
          return parts[parts.length - 1];
        }
      }
    } catch (e) { /* ignore */ }

    return null;
  }

  // Heurística: detecta si la propia fila ya deja rastro de OOR en DOM
  function rowLooksOOR(tr) {
    if (!tr) return false;

    // 1) Si el servidor ya dejó la marca, úsala sin más
    if (tr.classList.contains("row-flag-alert") || tr.getAttribute("data-row-alert") === "1") {
      return true;
    }

    // 2) Atributos/celdas específicos
    if (tr.getAttribute("data-has-oor") === "1" || tr.querySelector('[data-oor="1"]')) {
      return true;
    }

    // 3) Iconos típicos de alerta
    var imgs = tr.querySelectorAll("img, svg, use");
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      var src = (el.getAttribute("src") || el.getAttribute("href") || "").toLowerCase();
      var alt = (el.getAttribute("alt") || el.getAttribute("title") || "").toLowerCase();
      if (OOR_ICON_HINTS.some(function (k) { return src.indexOf(k) > -1 || alt.indexOf(k) > -1; })) {
        return true;
      }
    }

    // 4) Texto explícito en celdas
    var text = (tr.innerText || "").toLowerCase();
    if (OOR_TEXT_PATTERNS.some(function (k) { return text.indexOf(k) > -1; })) {
      return true;
    }

    return false;
  }

  // Si el proyecto provee un helper opcional para resolver OOR por lote:
  // window.infolabsaGetOorSamples(sampleUIDs: string[]) => Promise<Set<string> | string[]>
  function hasHelper() {
    return typeof window.infolabsaGetOorSamples === "function";
  }

  function toSet(x) {
    if (!x) return new Set();
    if (x instanceof Set) return x;
    if (Array.isArray(x)) return new Set(x);
    try {
      return new Set(Object.values(x));
    } catch (e) {
      return new Set();
    }
  }

  // Escanea una tabla y marca filas OOR
  function processTable(tbl) {
    if (!tbl) return;

    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;

    var rows = Array.prototype.slice.call(tbody.rows || []);
    if (rows.length === 0) return;

    // 1) Si la fila ya implica OOR por DOM, marcamos directo (barato)
    rows.forEach(function (tr) {
      if (rowLooksOOR(tr)) {
        markRow(tr);
        tr.setAttribute("data-infolabsa-processed", "1");
      }
    });

    // 2) Si existe helper opcional y aún hay filas sin resolver, usamos el helper (batch)
    if (!hasHelper()) {
      return; // sin helper, terminamos acá (ya marcamos lo que se pudo por DOM)
    }

    var unresolved = rows.filter(function (tr) {
      return tr.getAttribute("data-infolabsa-processed") !== "1";
    });
    if (unresolved.length === 0) return;

    var uidMap = new Map();
    unresolved.forEach(function (tr) {
      var uid = getSampleUIDFromRow(tr);
      if (uid) {
        if (!uidMap.has(uid)) uidMap.set(uid, []);
        uidMap.get(uid).push(tr);
      }
    });

    var uids = Array.from(uidMap.keys());
    if (uids.length === 0) return;

    // Consulta batch al helper
    window.infolabsaGetOorSamples(uids)
      .then(function (result) {
        var oorSet = toSet(result);
        uids.forEach(function (uid) {
          var trs = uidMap.get(uid) || [];
          var isOOR = oorSet.has(uid);
          trs.forEach(function (tr) {
            if (isOOR) {
              markRow(tr);
            }
            tr.setAttribute("data-infolabsa-processed", "1");
          });
        });
      })
      .catch(function (err) {
        log("helper error", err);
        // Falla silenciosa: no marcamos nada extra
      });
  }

  // Escanea todo el documento (todas las tablas de listados conocidas)
  var scanAll = debounce(function (root) {
    root = root || document;
    TABLE_SELECTORS.forEach(function (sel) {
      var tables = root.querySelectorAll(sel);
      Array.prototype.forEach.call(tables, processTable);
    });
  }, 100);

  // Observa cambios en DOM (recargas parciales, paginación, filtros…)
  var observer = new MutationObserver(function (mutations) {
    var shouldScan = false;
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.addedNodes && m.addedNodes.length) {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) scanAll(document);
  });

  function startObserver() {
    try {
      observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true
      });
    } catch (e) {
      // Nada
    }
  }

  // Re-scan después de llamadas AJAX de los listados (Plone/SENAITE hace POST a /folderitems)
  function hookAjaxComplete() {
    if (!window.jQuery) return;
    try {
      jQuery(document).ajaxComplete(function (_evt, _xhr, settings) {
        try {
          var url = (settings && settings.url) || "";
          if (/\/folderitems(\?|$)/.test(url)) {
            scanAll(document);
          }
        } catch (e) {
          // Nada
        }
      });
    } catch (e) {
      // Nada
    }
  }

  // Arranque
  function init() {
    scanAll(document);
    startObserver();
    hookAjaxComplete();
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(init, 0);
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }

  // --- API mínima para depurar ---
  window.__infolabsa__ = {
    rescan: function () { scanAll(document); }
  };
})();
