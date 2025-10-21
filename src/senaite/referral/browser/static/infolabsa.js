/* eslint-disable no-console */
(function () {
  "use strict";

  var TABLE_SELECTORS = [
    "table.listing",
    "table.listing-table",
    "table#listing",
    "table.table"
  ];

  var OOR_TEXT_PATTERNS = [
    "fuera de rango",
    "out of range",
    "oor",
    "range violation",
    "out-of-range"
  ];

  var OOR_ICON_HINTS = [
    "exclamation",
    "warning"
  ];

  function debounce(fn, wait) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  function log() {
    if (window && window.localStorage && localStorage.getItem("infolabsa.debug") === "1") {
      var args = Array.prototype.slice.call(arguments);
      args.unshift("[infolabsa]");
      console.log.apply(console, args);
    }
  }

  function markRow(tr) {
    if (!tr) return;
    if (!tr.classList.contains("row-flag-alert")) {
      tr.classList.add("row-flag-alert");
    }
    if (tr.getAttribute("data-row-alert") !== "1") {
      tr.setAttribute("data-row-alert", "1");
    }
  }

  function getSampleUIDFromRow(tr) {
    if (!tr) return null;

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

    try {
      var firstLink = tr.querySelector("td a[href]");
      if (firstLink) {
        var href = firstLink.getAttribute("href") || "";
        var parts = href.split(/[\/#?]/).filter(Boolean);
        if (parts.length) {
          return parts[parts.length - 1];
        }
      }
    } catch (e) { /* ignore */ }

    return null;
  }

  function rowLooksOOR(tr) {
    if (!tr) return false;

    if (tr.classList.contains("row-flag-alert") || tr.getAttribute("data-row-alert") === "1") {
      return true;
    }

    if (tr.getAttribute("data-has-oor") === "1" || tr.querySelector('[data-oor="1"]')) {
      return true;
    }

    var imgs = tr.querySelectorAll("img, svg, use");
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      var src = (el.getAttribute("src") || el.getAttribute("href") || "").toLowerCase();
      var alt = (el.getAttribute("alt") || el.getAttribute("title") || "").toLowerCase();
      if (OOR_ICON_HINTS.some(function (k) { return src.indexOf(k) > -1 || alt.indexOf(k) > -1; })) {
        return true;
      }
    }

    var text = (tr.innerText || "").toLowerCase();
    if (OOR_TEXT_PATTERNS.some(function (k) { return text.indexOf(k) > -1; })) {
      return true;
    }

    return false;
  }

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

  function processTable(tbl) {
    if (!tbl) return;

    var tbody = tbl.tBodies && tbl.tBodies[0];
    if (!tbody) return;

    var rows = Array.prototype.slice.call(tbody.rows || []);
    if (rows.length === 0) return;

    rows.forEach(function (tr) {
      if (rowLooksOOR(tr)) {
        markRow(tr);
        tr.setAttribute("data-infolabsa-processed", "1");
      }
    });

    if (!hasHelper()) {
      return;
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
      });
  }

  var scanAll = debounce(function (root) {
    root = root || document;
    TABLE_SELECTORS.forEach(function (sel) {
      var tables = root.querySelectorAll(sel);
      Array.prototype.forEach.call(tables, processTable);
    });
  }, 100);

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
    } catch (e) {}
  }

  function hookAjaxComplete() {
    if (!window.jQuery) return;
    try {
      jQuery(document).ajaxComplete(function (_evt, _xhr, settings) {
        try {
          var url = (settings && settings.url) || "";
          if (/\/folderitems(\?|$)/.test(url)) {
            scanAll(document);
          }
        } catch (e) {}
      });

      // 🔹 EXTRA: algunos listados disparan este evento custom al terminar de renderizar
      jQuery(document).on("listing:rendered", function () {
        scanAll(document);
      });
    } catch (e) {}
  }

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

  window.__infolabsa__ = {
    rescan: function () { scanAll(document); }
  };
})();
