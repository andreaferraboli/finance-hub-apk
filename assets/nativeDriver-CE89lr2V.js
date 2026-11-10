var _=Object.defineProperty;var I=(r,e,t)=>e in r?_(r,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):r[e]=t;var s=(r,e,t)=>I(r,typeof e!="symbol"?e+"":e,t);import{b0 as M,r as u,e8 as D,ao as S}from"./index-C3S7y20K.js";import{c as P}from"./claudeProxy-Dgl5x0mg.js";import{m as c,a as g,ac as q,ad as V}from"./agentWiring-DGesACSR.js";const j=`/*
 * Finanz AI browser: snapshot della pagina.
 *
 * Produce una rappresentazione compatta e ripulita del DOM visibile.
 * Regole (ricontrollate anche lato Dart dal Sanitizer):
 *  - mai valori di input, textarea, select;
 *  - mai campi password o hidden, mai campi con autocomplete
 *    one-time-code / current-password;
 *  - niente script, style, noscript, iframe, svg, canvas, template;
 *  - niente cookie ne' storage (non vengono mai letti);
 *  - niente attributi data-* nel risultato (l'attributo con l'id, con nome
 *    legato al nonce, serve solo a noi);
 *  - URL e href senza query string.
 * L'unica modifica al DOM e' l'attributo con l'id sugli elementi
 * interattivi, che rende stabile l'id numerico tra uno snapshot e l'altro;
 * l'unica scrittura e' fill(), la compilazione assistita chiesta
 * dall'utente (mai password, OTP o campi nascosti, mai invio del form).
 *
 * Sezioni:
 *  - snapshot / describe / click / scroll: lettura e navigazione;
 *  - fields / fill: compilazione assistita (Dart decide cosa compilare);
 *  - recipe: motore FISSO delle ricette di estrazione (le ricette sono dati:
 *    selettori ed etichette, mai codice);
 *  - outline: struttura della pagina per far proporre una ricetta a Claude.
 * __FZ_NS__ e __FZ_SECRET__ sono sostituiti da Dart (WebViewDriver).
 */
(function () {
  // Nomi con un nonce casuale generato da Dart a ogni caricamento di pagina:
  // la pagina non puo' conoscerli prima dell'iniezione. Le funzioni sono
  // definite non scrivibili e non configurabili.
  var NS = '__FZ_NS__';
  var SECRET = '__FZ_SECRET__';
  var ATTR = 'data-' + NS;
  var existing = Object.getOwnPropertyDescriptor(window, NS + 'ready');
  if (existing) {
    if (existing.value === SECRET && !existing.writable && !existing.configurable) return 'ok';
    return 'taken';
  }
  var nextId = 1;
  function define(name, value) {
    Object.defineProperty(window, NS + name, {
      value: value, writable: false, configurable: false, enumerable: false
    });
  }

  var EXCLUDED = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, IFRAME: 1, SVG: 1, CANVAS: 1,
    TEMPLATE: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, OBJECT: 1,
    EMBED: 1, VIDEO: 1, AUDIO: 1, HEAD: 1, META: 1, LINK: 1
  };
  var BLOCKISH = 'div,p,table,ul,ol,li,h1,h2,h3,h4,h5,h6,section,article,header,footer,nav,main,aside,form,dl,dt,dd,tr';
  var SENSITIVE_PARAM = /token|code|session|sess|auth|key|sig|state|nonce|pass|pwd|otp|pin|jwt|sid|secret|ticket|credential|assertion|saml/i;
  var SECRET_AUTOCOMPLETE = /one-time-code|current-password|new-password|cc-number|cc-csc/i;

  function cleanUrl(href) {
    try {
      var u = new URL(href, location.href);
      var keep = [];
      u.searchParams.forEach(function (v, k) {
        if (!SENSITIVE_PARAM.test(k)) keep.push([k, v]);
      });
      var out = u.origin + u.pathname;
      if (keep.length) {
        out += '?' + keep.map(function (p) {
          return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]);
        }).join('&');
      }
      return out;
    } catch (e) {
      return '';
    }
  }

  function hrefPath(href) {
    try {
      var u = new URL(href, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return u.protocol;
      var out = (u.host === location.host ? '' : u.host) + u.pathname;
      // Rotte delle single page app (#/conti): fanno parte della pagina.
      var hash = (u.hash || '').split('?')[0];
      if ((hash.indexOf('#/') === 0 || hash.indexOf('#!/') === 0) && hash.indexOf('=') < 0) {
        out += hash;
      }
      return out;
    } catch (e) {
      return '';
    }
  }

  var styleCache = new Map();
  function style(el) {
    var s = styleCache.get(el);
    if (!s) {
      s = window.getComputedStyle(el);
      styleCache.set(el, s);
    }
    return s;
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    var s = style(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
    if (parseFloat(s.opacity) === 0) return false;
    if (s.display !== 'contents' && el.getClientRects().length === 0) return false;
    return true;
  }

  function isExcluded(el) {
    return EXCLUDED[el.tagName] === 1 || el.tagName.toLowerCase() === 'svg';
  }

  function squash(text) {
    return (text || '').replace(/\\s+/g, ' ').trim();
  }

  /* Testo visibile di un elemento, escludendo i campi e i tag esclusi. */
  function textOf(el) {
    var out = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType === 1) {
          if (isExcluded(node) || !isVisible(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) out.push(node.nodeValue);
    return squash(out.join(' '));
  }

  /* Righe di un blocco: testo raggruppato per antenato non inline. */
  function linesOf(el) {
    var lines = [];
    var current = '';
    var currentBlock = null;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType === 1) {
          if (isExcluded(node) || !isVisible(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var text = squash(node.nodeValue);
      if (!text) continue;
      var block = node.parentElement;
      while (block && block !== el && style(block).display.indexOf('inline') === 0) {
        block = block.parentElement;
      }
      if (block !== currentBlock) {
        if (current) lines.push(current);
        current = text;
        currentBlock = block;
      } else {
        current += ' ' + text;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function matchesAny(el, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        if (el.matches(selectors[i])) return true;
      } catch (e) { /* selettore non valido: ignorato */ }
    }
    return false;
  }

  function snapshot(options) {
    options = options || {};
    var maxChars = options.maxChars || 45000;
    var maxElements = options.maxElements || 300;
    var groups = options.groupSelectors || [];
    var blocks = [];
    var size = 0;
    var truncated = false;
    styleCache = new Map();

    function push(block, length) {
      if (truncated) return;
      if (size + length > maxChars) {
        truncated = true;
        return;
      }
      size += length;
      blocks.push(block);
    }

    function emitTable(el) {
      var rows = el.querySelectorAll('tr, [role=row]');
      var headers = [];
      var body = [];
      for (var i = 0; i < rows.length && body.length < 200; i++) {
        var row = rows[i];
        if (!isVisible(row)) continue;
        var cells = row.querySelectorAll('th, td, [role=cell], [role=gridcell], [role=columnheader], [role=rowheader]');
        var values = [];
        var allHeaders = cells.length > 0;
        for (var j = 0; j < cells.length; j++) {
          var cell = cells[j];
          if (!isVisible(cell)) continue;
          values.push(textOf(cell).slice(0, 200));
          var tag = cell.tagName;
          var role = cell.getAttribute('role');
          if (!(tag === 'TH' || role === 'columnheader')) allHeaders = false;
        }
        if (!values.length) continue;
        if (allHeaders && !headers.length && !body.length) headers = values;
        else body.push(values);
      }
      if (!headers.length && !body.length) return;
      var length = JSON.stringify(headers).length + JSON.stringify(body).length;
      push({ t: 'table', h: headers, r: body }, length);
    }

    function walk(el) {
      if (truncated || isExcluded(el) || !isVisible(el)) return;
      var tag = el.tagName;
      var role = el.getAttribute('role');
      if (tag === 'TABLE' || role === 'table' || role === 'grid') {
        emitTable(el);
        return;
      }
      if (groups.length && matchesAny(el, groups)) {
        var lines = linesOf(el).map(function (l) { return l.slice(0, 200); });
        if (lines.length) push({ t: 'g', x: lines }, lines.join(' ').length);
        return;
      }
      if (/^H[1-6]$/.test(tag) || role === 'heading') {
        var level = /^H[1-6]$/.test(tag) ? parseInt(tag.charAt(1), 10) : parseInt(el.getAttribute('aria-level') || '2', 10);
        var heading = textOf(el);
        if (heading) push({ t: 'h', l: level, x: heading.slice(0, 300) }, heading.length);
        return;
      }
      if ((tag === 'LI' || role === 'listitem') && !el.querySelector('table, ul, ol, [role=table], [role=grid]')) {
        var item = textOf(el);
        if (item) push({ t: 'li', x: item.slice(0, 600) }, item.length);
        return;
      }
      var buffer = '';
      function flush() {
        var text = squash(buffer);
        buffer = '';
        if (text) push({ t: 'p', x: text.slice(0, 600) }, text.length);
      }
      for (var child = el.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          buffer += ' ' + child.nodeValue;
        } else if (child.nodeType === 1) {
          if (isExcluded(child) || !isVisible(child)) continue;
          var inline = style(child).display.indexOf('inline') === 0 &&
            !child.querySelector(BLOCKISH) &&
            !(groups.length && matchesAny(child, groups));
          if (inline) {
            buffer += ' ' + textOf(child);
          } else {
            flush();
            walk(child);
          }
        }
      }
      flush();
    }

    if (document.body) walk(document.body);

    var login = false;
    var elements = [];
    var candidates = document.querySelectorAll(
      'a[href], button, input, select, textarea, summary, [role=button], [role=link], ' +
      '[role=tab], [role=menuitem], [role=option], [role=switch], [onclick], [tabindex]:not([tabindex="-1"])'
    );
    for (var k = 0; k < candidates.length; k++) {
      var el = candidates[k];
      if (!isVisible(el)) continue;
      var tagName = el.tagName.toLowerCase();
      var type = (el.getAttribute('type') || '').toLowerCase();
      var autocomplete = el.getAttribute('autocomplete') || '';
      if (tagName === 'input' && (type === 'password' || SECRET_AUTOCOMPLETE.test(autocomplete))) {
        login = true;
        continue;
      }
      if (tagName === 'input' && type === 'hidden') continue;
      if (SECRET_AUTOCOMPLETE.test(autocomplete)) {
        login = true;
        continue;
      }
      if (elements.length >= maxElements) {
        truncated = true;
        continue;
      }
      var id = el.getAttribute(ATTR);
      if (!id) {
        id = String(nextId++);
        el.setAttribute(ATTR, id);
      }
      elements.push(describe(el, parseInt(id, 10)));
    }

    return {
      title: document.title || '',
      url: cleanUrl(location.href),
      blocks: blocks,
      elements: elements,
      truncated: truncated,
      login: login
    };
  }

  function labelFor(el) {
    var aria = el.getAttribute('aria-label');
    if (aria) return aria;
    if (el.id) {
      var label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) return textOf(label);
    }
    var wrapping = el.closest('label');
    if (wrapping) return textOf(wrapping);
    return el.getAttribute('placeholder') || el.getAttribute('name') || '';
  }

  var ANCESTOR = 'button, a, [role=button], [role=link], form, dialog, [role=dialog], [role=alertdialog], [aria-modal=true]';
  var DIALOG = 'dialog, [role=dialog], [role=alertdialog], [aria-modal=true]';

  /* Etichetta di un elemento come la calcola anche Dart (rawLabel). */
  function labelOf(info) {
    return info.text || info.aria || info.title || '';
  }

  /* Descrittore di un elemento interattivo: MAI il suo valore. */
  function describe(el, id) {
    var tagName = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    var isField = tagName === 'input' || tagName === 'select' || tagName === 'textarea';
    var inForm = !!el.closest('form');
    var submit = (tagName === 'button' && inForm && (type === '' || type === 'submit')) ||
      (tagName === 'input' && (type === 'submit' || type === 'image'));
    var text = isField ? labelFor(el) : textOf(el);
    var href = tagName === 'a' ? hrefPath(el.getAttribute('href') || '') : '';
    var ancestor = el.parentElement ? el.parentElement.closest(ANCESTOR) : null;
    var ancestorLabel = '';
    if (ancestor) {
      ancestorLabel = ancestor.getAttribute('aria-label') || ancestor.getAttribute('title') ||
        textOf(ancestor);
    }
    return {
      id: id,
      tag: tagName,
      role: el.getAttribute('role') || (tagName === 'a' ? 'link' : (tagName === 'button' ? 'button' : '')),
      text: squash(text).slice(0, 120),
      aria: squash(el.getAttribute('aria-label') || '').slice(0, 120),
      title: squash(el.getAttribute('title') || '').slice(0, 120),
      href: href,
      type: type,
      inForm: inForm,
      inDialog: !!el.closest(DIALOG),
      ancestor: squash(ancestorLabel).slice(0, 200),
      submit: submit,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true'
    };
  }

  function byId(id) {
    var matches = document.querySelectorAll('[' + ATTR + '="' + String(parseInt(id, 10)) + '"]');
    // Un id duplicato e' sospetto: meglio non cliccare niente.
    return matches.length === 1 ? matches[0] : null;
  }

  define('snapshot', function (options) {
    return snapshot(options);
  });

  define('describe', function (id) {
    var el = byId(id);
    if (!el) return null;
    styleCache = new Map();
    var info = describe(el, parseInt(id, 10));
    info.visible = isVisible(el);
    return info;
  });

  /* Click con l'etichetta attesa: se l'elemento ora ha un'altra etichetta
     (pagina cambiata, id riassegnato) il click non parte. */
  define('click', function (id, expectedLabel) {
    var el = byId(id);
    if (!el) return 'missing';
    styleCache = new Map();
    if (!isVisible(el)) return 'hidden';
    var label = squash(labelOf(describe(el, parseInt(id, 10))));
    if (label !== squash(String(expectedLabel || ''))) return 'label';
    // I link in una nuova finestra si aprono nella stessa vista.
    if (el.tagName === 'A' && el.getAttribute('target')) el.setAttribute('target', '_self');
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.click();
    return 'ok';
  });

  function scroller() {
    var root = document.scrollingElement || document.documentElement;
    if (root.scrollHeight > root.clientHeight + 4) return root;
    var best = null;
    var bestArea = 0;
    var all = document.querySelectorAll('div, main, section, article');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.scrollHeight <= el.clientHeight + 4) continue;
      var overflow = window.getComputedStyle(el).overflowY;
      if (overflow !== 'auto' && overflow !== 'scroll') continue;
      var area = el.clientWidth * el.clientHeight;
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    return best || root;
  }

  define('scroll', function (direction) {
    var el = scroller();
    var step = Math.round((el === document.scrollingElement ? window.innerHeight : el.clientHeight) * 0.8);
    if (direction === 'top') el.scrollTop = 0;
    else if (direction === 'bottom') el.scrollTop = el.scrollHeight;
    else if (direction === 'up') el.scrollTop = el.scrollTop - step;
    else el.scrollTop = el.scrollTop + step;
    return { top: Math.round(el.scrollTop), height: el.scrollHeight, view: el.clientHeight };
  });

  /* ---------------------------------------------------------------------
   * Compilazione assistita
   * ------------------------------------------------------------------- */

  var NEVER_FILL_TYPES = /^(password|hidden|file|checkbox|radio|submit|button|reset|image|range|color)$/;

  function ensureId(el) {
    var id = el.getAttribute(ATTR);
    if (!id) {
      id = String(nextId++);
      el.setAttribute(ATTR, id);
    }
    return parseInt(id, 10);
  }

  /* Firma del campo: se al momento di compilare non coincide, non si scrive. */
  function signatureOf(el) {
    return [el.tagName.toLowerCase(), (el.getAttribute('type') || '').toLowerCase(),
      el.getAttribute('autocomplete') || '', el.getAttribute('name') || '', el.id || '',
      squash(labelFor(el)).slice(0, 80)].join('|');
  }

  /* Testo del form o del dialog (titoli, etichette, pulsanti, action), o in
     mancanza titolo della pagina e intestazioni: serve a Dart per non
     compilare dentro un bonifico o una modifica dati. Mai valori. */
  function contextOf(el) {
    var container = el.closest('form') || el.closest(DIALOG);
    var parts = [];
    if (container) {
      parts.push(container.getAttribute('aria-label') || '', container.getAttribute('title') || '');
      if (container.tagName === 'FORM' && container.getAttribute('action')) {
        parts.push(hrefPath(container.getAttribute('action')));
      }
      parts.push(textOf(container).slice(0, 400));
      var buttons = container.querySelectorAll('button, input[type=submit], input[type=button]');
      for (var i = 0; i < buttons.length && i < 10; i++) {
        var b = buttons[i];
        parts.push(b.tagName === 'INPUT' ? (b.getAttribute('value') || '') : textOf(b));
      }
    } else {
      parts.push(document.title || '');
      var heads = document.querySelectorAll('h1, h2');
      for (var j = 0; j < heads.length && j < 3; j++) parts.push(textOf(heads[j]));
    }
    return squash(parts.join(' ')).slice(0, 600);
  }

  /* C'e' un selettore del prefisso internazionale separato vicino al campo? */
  function hasPrefixSelector(el) {
    var node = el.parentElement;
    // Solo i contenitori vicini al campo, mai l'intero form.
    for (var depth = 0; node && depth < 2; depth++, node = node.parentElement) {
      if (node.tagName === 'FORM' || node === document.body) break;
      var near = node.querySelectorAll('select, button, [role=combobox], [role=button], span, div');
      for (var i = 0; i < near.length && i < 40; i++) {
        var n = near[i];
        if (n === el || n.contains(el)) continue;
        if (n.tagName === 'SELECT') {
          var opt = n.options && n.selectedIndex >= 0 ? n.options[n.selectedIndex] : null;
          if (opt && /\\+\\s?\\d{1,3}/.test(opt.text || '')) return true;
          if (/prefiss|prefix|country|paese|vorwahl|indicatif/i.test((n.getAttribute('aria-label') || '') + ' ' + (n.getAttribute('name') || ''))) return true;
          continue;
        }
        var t = squash(n.textContent || '');
        if (t.length <= 8 && /^(\\S+\\s)?\\+\\s?\\d{1,3}$/.test(t)) return true;
      }
    }
    return false;
  }

  define('fields', function () {
    styleCache = new Map();
    var out = [];
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length && out.length < 40; i++) {
      var el = inputs[i];
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      var ac = el.getAttribute('autocomplete') || '';
      if (NEVER_FILL_TYPES.test(type) || SECRET_AUTOCOMPLETE.test(ac)) continue;
      if (!isVisible(el)) continue;
      var max = parseInt(el.getAttribute('maxlength') || '0', 10);
      out.push({
        id: ensureId(el),
        tag: 'input',
        type: type,
        autocomplete: ac.slice(0, 60),
        label: squash(labelFor(el)).slice(0, 120),
        placeholder: squash(el.getAttribute('placeholder') || '').slice(0, 60),
        name: (el.getAttribute('name') || '').slice(0, 60),
        htmlId: (el.id || '').slice(0, 60),
        inputMode: el.getAttribute('inputmode') || '',
        maxLength: max > 0 ? max : 0,
        inForm: !!el.closest('form'),
        inDialog: !!el.closest(DIALOG),
        context: contextOf(el),
        prefix: hasPrefixSelector(el),
        disabled: !!el.disabled,
        readOnly: !!el.readOnly,
        // Solo se e' vuoto: il valore non esce mai.
        empty: !el.value,
        sig: signatureOf(el)
      });
    }
    return out;
  });

  /* Scrive i valori decisi da Dart con il setter nativo e gli eventi
     input/change/blur (React, Angular, Vue li vedono come digitati). Non
     invia il form. Rifiuta campi segreti, nascosti o cambiati. */
  define('fill', function (commands) {
    styleCache = new Map();
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    var results = [];
    var filled = 0;
    for (var i = 0; i < (commands || []).length && i < 20; i++) {
      var c = commands[i];
      var el = byId(c.id);
      if (!el || el.tagName !== 'INPUT') { results.push('missing'); continue; }
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (NEVER_FILL_TYPES.test(type) || SECRET_AUTOCOMPLETE.test(el.getAttribute('autocomplete') || '')) {
        results.push('blocked'); continue;
      }
      if (el.disabled || el.readOnly || !isVisible(el)) { results.push('blocked'); continue; }
      if (signatureOf(el) !== String(c.sig || '')) { results.push('changed'); continue; }
      el.focus();
      setter.call(el, String(c.value == null ? '' : c.value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('blur'));
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      el.blur();
      filled++;
      results.push('ok');
    }
    return { filled: filled, results: results };
  });

  /* ---------------------------------------------------------------------
   * Motore delle ricette (fisso): legge testi con selettori ed etichette.
   * Mai valori dei campi (textOf salta input, select, textarea), niente
   * href, solo attributi descrittivi.
   * ------------------------------------------------------------------- */

  var RECIPE_ATTR = /^(title|aria-label|datetime|alt|data-[a-z0-9-]{1,30})$/;
  var MAX_ITEMS = 500;

  function norm(text) {
    return squash(text).toLowerCase();
  }

  function ownText(el) {
    var out = '';
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) out += ' ' + c.nodeValue;
    }
    return squash(out);
  }

  /* Elemento che contiene il valore accanto all'etichetta: il fratello
     successivo con testo, altrimenti il genitore. */
  function byLabel(base, selector, label, errors) {
    var wanted = norm(label);
    var list;
    try {
      list = selector ? base.querySelectorAll(selector) : base.querySelectorAll('*');
    } catch (e) {
      errors.push('selettore non valido: ' + selector);
      return null;
    }
    for (var i = 0; i < list.length && i < 3000; i++) {
      var c = list[i];
      if (isExcluded(c)) continue;
      var own = norm(ownText(c) || (c.children.length === 0 ? c.textContent : ''));
      if (!own || own.indexOf(wanted) !== 0) continue;
      var sib = c.nextElementSibling;
      while (sib && !textOf(sib)) sib = sib.nextElementSibling;
      return sib || c.parentElement;
    }
    return null;
  }

  function classesOf(el, base) {
    var out = [];
    for (var n = el; n && out.length < 6; n = n.parentElement) {
      if (typeof n.className === 'string' && n.className) out.push(n.className);
      if (n === base) break;
    }
    return out.join(' ').slice(0, 200);
  }

  function fieldValue(base, f, errors) {
    if (!f) return null;
    var el = base;
    if (f.label) {
      el = byLabel(base, f.selector, f.label, errors);
    } else if (f.selector) {
      try {
        el = base.querySelector(f.selector);
      } catch (e) {
        errors.push('selettore non valido: ' + f.selector);
        return null;
      }
    }
    if (!el || isExcluded(el)) return null;
    var text;
    if (f.attr) {
      if (!RECIPE_ATTR.test(f.attr)) return null;
      text = el.getAttribute(f.attr) || '';
    } else {
      text = textOf(el);
    }
    return [squash(text).slice(0, 300), f.cls ? classesOf(el, base) : ''];
  }

  function findByLabel(label) {
    var wanted = norm(label);
    var list = document.querySelectorAll('a, button, [role=button], [role=link]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!isVisible(el)) continue;
      var info = describe(el, 0);
      var text = labelOf(info);
      if (norm(text) === wanted) return { id: ensureId(el), label: squash(text) };
    }
    return null;
  }

  define('recipe', function (spec) {
    styleCache = new Map();
    spec = spec || {};
    var errors = [];
    var out = { ready: true, errors: errors, scope: {}, lists: {}, holder: null, pagination: null };
    if (spec.waitFor) {
      try {
        out.ready = !!document.querySelector(spec.waitFor);
      } catch (e) {
        errors.push('selettore non valido: ' + spec.waitFor);
        out.ready = false;
      }
    }
    var scope = spec.scope || {};
    for (var key in scope) {
      if (Object.prototype.hasOwnProperty.call(scope, key)) {
        out.scope[key] = fieldValue(document.body, scope[key], errors);
      }
    }
    var lists = spec.lists || {};
    for (var name in lists) {
      if (!Object.prototype.hasOwnProperty.call(lists, name)) continue;
      var list = lists[name];
      var items = [];
      var nodes;
      try {
        nodes = document.querySelectorAll(list.item);
      } catch (e) {
        errors.push('selettore non valido: ' + list.item);
        nodes = [];
      }
      for (var i = 0; i < nodes.length && items.length < MAX_ITEMS; i++) {
        var node = nodes[i];
        if (!isVisible(node)) continue;
        var row = {};
        var found = false;
        for (var field in list.fields) {
          if (!Object.prototype.hasOwnProperty.call(list.fields, field)) continue;
          var value = fieldValue(node, list.fields[field], errors);
          if (value && value[0]) found = true;
          row[field] = value;
        }
        if (found) items.push(row);
      }
      out.lists[name] = { count: items.length, items: items };
    }
    if (spec.holder) out.holder = fieldValue(document.body, spec.holder, errors);
    if (spec.pagination && spec.pagination.label) out.pagination = findByLabel(spec.pagination.label);
    return out;
  });

  /* ---------------------------------------------------------------------
   * Struttura della pagina per propose_recipe: selettori di tabelle e
   * gruppi ripetuti con un campione di testo (ripulito poi dal Sanitizer).
   * ------------------------------------------------------------------- */

  function stableClasses(el) {
    if (typeof el.className !== 'string') return [];
    return el.className.split(/\\s+/).filter(function (c) {
      // Classi generate (css-1x2y3z, sc-AbCd12) cambiano a ogni rilascio.
      return c && c.length <= 40 && !/\\d{3,}/.test(c) && !/^(css|sc|jsx|emotion)-/.test(c);
    }).slice(0, 2);
  }

  function selectorFor(el) {
    if (el.id && !/\\d{3,}/.test(el.id) && el.id.length <= 40) return '#' + CSS.escape(el.id);
    var sel = el.tagName.toLowerCase();
    var classes = stableClasses(el);
    if (classes.length) sel += '.' + classes.map(function (c) { return CSS.escape(c); }).join('.');
    return sel;
  }

  function childOutline(item) {
    var out = [];
    var all = item.querySelectorAll('*');
    for (var i = 0; i < all.length && out.length < 10; i++) {
      var c = all[i];
      if (isExcluded(c) || !isVisible(c)) continue;
      var own = ownText(c);
      if (!own) continue;
      var path = selectorFor(c);
      out.push({ sel: path, text: own.slice(0, 40), cls: stableClasses(c).join(' ') });
    }
    return out;
  }

  define('outline', function () {
    styleCache = new Map();
    var out = { headings: [], tables: [], groups: [], pagination: [] };
    var heads = document.querySelectorAll('h1, h2, [role=heading]');
    for (var h = 0; h < heads.length && out.headings.length < 4; h++) {
      if (!isVisible(heads[h])) continue;
      out.headings.push({ sel: selectorFor(heads[h]), text: textOf(heads[h]).slice(0, 60) });
    }
    var tables = document.querySelectorAll('table, [role=table], [role=grid]');
    for (var t = 0; t < tables.length && out.tables.length < 4; t++) {
      var table = tables[t];
      if (!isVisible(table)) continue;
      var sel = selectorFor(table);
      var isTable = table.tagName === 'TABLE';
      var rowSel = isTable ? sel + (table.querySelector('tbody') ? ' tbody tr' : ' tr') : sel + ' [role=row]';
      var headers = [];
      var ths = table.querySelectorAll('th, [role=columnheader]');
      for (var k = 0; k < ths.length && k < 12; k++) headers.push(textOf(ths[k]).slice(0, 30));
      var rows = [];
      try { rows = document.querySelectorAll(rowSel); } catch (e) { rows = []; }
      var sample = null;
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].querySelector('td, [role=cell], [role=gridcell]')) { sample = rows[r]; break; }
      }
      var cells = [];
      if (sample) {
        var tds = sample.querySelectorAll('td, [role=cell], [role=gridcell]');
        for (var c = 0; c < tds.length && c < 12; c++) {
          cells.push({ n: c + 1, text: textOf(tds[c]).slice(0, 40), cls: stableClasses(tds[c]).join(' ') });
        }
      }
      out.tables.push({ sel: sel, rows: rowSel, count: rows.length, headers: headers, cells: cells });
    }
    var seen = {};
    var all = document.body ? document.body.querySelectorAll('section, article, li, div, a, [role=listitem], [role=row]') : [];
    for (var i = 0; i < all.length && i < 4000 && out.groups.length < 8; i++) {
      var el = all[i];
      if (el.closest('table, nav, header, footer, form')) continue;
      var classes = stableClasses(el);
      if (!classes.length) continue;
      var gsel = selectorFor(el);
      if (seen[gsel]) continue;
      seen[gsel] = true;
      var count = 0;
      try { count = document.querySelectorAll(gsel).length; } catch (e) { continue; }
      var text = textOf(el);
      if (text.length < 8 || text.length > 400) continue;
      if (el.children.length < 2) continue;
      var hasNumber = /\\d+[.,]\\d{2}/.test(text) || /\\d{4}/.test(text);
      if (count < 2 && !hasNumber) continue;
      out.groups.push({ sel: gsel, count: count, children: childOutline(el) });
    }
    var links = document.querySelectorAll('a, button, [role=button], [role=link]');
    for (var l = 0; l < links.length && out.pagination.length < 4; l++) {
      if (!isVisible(links[l])) continue;
      var label = squash(labelOf(describe(links[l], 0)));
      if (/^(pagina successiva|successiv[ae]|next( page)?|weiter|nächste seite|mostra altr[ie]|carica altr[ie]|load more|show more|mehr (laden|anzeigen)|›|»|>)$/i.test(label)) {
        out.pagination.push({ label: label, tag: links[l].tagName.toLowerCase() });
      }
    }
    return out;
  });

  define('ready', SECRET);
  return 'ok';
})();
`;function oe(r){switch(r){case"phone":case"phoneNational":return"telefono";case"givenName":return"nome";case"familyName":return"cognome";case"fullName":return"nome e cognome";case"birthDate":case"birthDay":case"birthMonth":case"birthYear":return"data di nascita";case"email":return"email"}}function z(r){if(typeof r!="object"||r===null||Array.isArray(r))return null;const e=r,t=e.id;if(typeof t!="number"||!(t>0))return null;const n=a=>typeof e[a]=="string"?e[a]:"",i=e.maxLength,l=n("type").toLowerCase();return{id:Math.trunc(t),tag:n("tag").toLowerCase(),type:l||"text",autocomplete:n("autocomplete").toLowerCase(),label:n("label"),placeholder:n("placeholder"),name:n("name"),htmlId:n("htmlId"),inputMode:n("inputMode").toLowerCase(),maxLength:typeof i=="number"&&i>0?Math.trunc(i):null,inForm:e.inForm===!0,inDialog:e.inDialog===!0,context:n("context"),hasPrefixSelector:e.prefix===!0,disabled:e.disabled===!0,readOnly:e.readOnly===!0,empty:e.empty!==!1,signature:n("sig")}}function A(r){return r.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_\-.[\]]/g," ")}function m(r){return g(`${r.label} ${r.placeholder} ${A(r.name)} ${A(r.htmlId)}`)}const B=new Set(["password","hidden","file","checkbox","radio","submit","button","reset","image","range","color","search","month","week","time","datetime-local"]),H=["one-time-code","current-password","new-password","cc-","transaction-"],k=["password*","passwort*","passcode","pin","otp","tan","codice*","code","codes","token","iban","bic","swift","importo","amount","betrag","montant","beneficiar*","destinatar*","payee","recipient*","empfanger*","causale","reference","riferimento","verwendungszweck","fiscal*","tax","steuer*","ssn","documento","document*","passaporto","passport","identita","identity","ausweis*","cvv","cvc","card number","numero carta","scadenza","expiry","cerca","search","otp code","secret","segreto","risposta","answer","domanda","question","nome utente","user name","username","benutzername","utente"],U=["bonific*","pagament*","paga","pagare","payment*","pay","pay now","zahl*","transfer*","trasferim*","giroconto*","virement*","uberweis*","send money","ricaric*","top up","topup","add money","versament*","withdraw*","prelev*","preliev*","auszahl*","deposit","deposita","einzahl*","compra","acquist*","buy*","kauf*","verkauf*","vend*","sell*","trade","trading","order*","ordin*","invest","investi","scambia*","exchange*","convert*","beneficiar*","destinatar*","payee","recipient*","empfanger*","causale","iban","importo","amount","betrag","modific*","modify","edit","change","aggiorna i","aggiorna dati","update your","andern","impostaz*","setting*","einstellung*","sicurezz*","secur*","sicherheit*","elimin*","delet*","cancell*","chiudi conto","close account","revoc*","blocca","block","sperr*","cvv*","limit*","limiti"],T=["telefono","cellulare","numero di telefono","numero cellulare","phone","phone number","mobile","mobile number","cellphone","telefonnummer","handynummer","handy","mobilnummer","telephone","telefon","tel","portable","movil"],O=["email","e mail","mail","posta elettronica","indirizzo email","courriel","correo"],$=["cognome","last name","lastname","surname","family name","nachname","familienname","nom de famille","apellido*"],W=["nome e cognome","nome completo","full name","fullname","vollstandiger name","nom complet","nombre completo"],Y=["nome","first name","firstname","given name","vorname","prenom","nombre"],N=["nascita","nato","nata","birth*","birthday","dob","geburt*","naissance","nacimiento"],v=["giorno","day","tag","jour","dia","gg","dd"],y=["mese","month","monat","mois","mes","mm"],w=["anno","year","jahr","annee","ano","aaaa","yyyy","jjjj"],J=new Set(["username","nome utente","user name","utente"]);function K(r){return r.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}class ce{constructor(e={}){s(this,"extraForbidden");s(this,"brandName");this.extraForbidden=e.extraForbidden??[],this.brandName=e.brandName??""}classify(e){if(!this.isFillable(e))return null;const t=this.kindOf(e);return t===null?null:{field:e,kind:t}}classifyAll(e){const t=[];for(const n of e){const i=this.classify(n);i&&t.push(i)}return t}isFillable(e){if(e.tag!=="input"||B.has(e.type)||e.disabled||e.readOnly||H.some(l=>e.autocomplete.includes(l)))return!1;const t=m(e);if(k.some(l=>c(t,l))&&!this.isUsernameAsContact(e))return!1;let n=g(e.context);return!e.inForm&&!e.inDialog&&(n=this.withoutBrand(n)),![...U,...this.extraForbidden.map(l=>g(l))].some(l=>c(n,l))}withoutBrand(e){const t=g(this.brandName);return t?e.replace(new RegExp(`(^| )${K(t)}(?= |$)`,"g")," ").replace(/ +/g," ").trim():e}isUsernameAsContact(e){const t=e.autocomplete,n=m(e);if(!t.includes("username")&&!c(n,"username")&&!c(n,"utente"))return!1;const i=n.replace(/\b(username|nome utente|utente|user name)\b/g," ");return k.filter(l=>!J.has(l)).some(l=>c(i,l))?!1:this.contactKind(e)!==null}contactKind(e){const t=m(e);return e.type==="email"||e.inputMode==="email"||O.some(n=>c(t,n))?"email":e.type==="tel"||e.inputMode==="tel"||T.some(n=>c(t,n))?"phone":null}kindOf(e){const t=e.autocomplete.split(/\s+/);for(const l of[...t].reverse()){let a=null;switch(l){case"tel":a="phone";break;case"tel-national":case"tel-local":a="phoneNational";break;case"given-name":a="givenName";break;case"family-name":a="familyName";break;case"name":a="fullName";break;case"bday":a="birthDate";break;case"bday-day":a="birthDay";break;case"bday-month":a="birthMonth";break;case"bday-year":a="birthYear";break;case"email":a="email";break;case"username":a=this.contactKind(e);break;default:a=null}if(a!==null)return a}const n=m(e),i=l=>l.some(a=>c(n,a));return e.type==="tel"?"phone":e.type==="email"?"email":e.type==="date"?i(N)?"birthDate":null:i(N)?i(v)&&!i(y)&&!i(w)?"birthDay":i(y)&&!i(v)&&!i(w)?"birthMonth":i(w)&&!i(v)&&!i(y)?"birthYear":"birthDate":i(T)?"phone":i(O)?"email":i(W)?"fullName":i($)?"familyName":i(Y)?"givenName":null}}function C(r){let e=r;for(let t=0;t<2&&typeof e=="string";t++){const n=e.trim();if(n===""||n==="null"||n==="undefined")return null;try{e=JSON.parse(n)}catch{return e}}return e??null}const d=r=>typeof r=="object"&&r!==null&&!Array.isArray(r);function G(r){switch(r){case"ok":return"ok";case"hidden":return"hidden";case"label":return"labelMismatch";default:return"missing"}}function L(r){const e=new Uint8Array(r);return crypto.getRandomValues(e),Array.from(e,t=>t.toString(16).padStart(2,"0")).join("")}const R={settleBeforeMs:600,settleAfterMs:400},F=r=>r>0?new Promise(e=>setTimeout(e,r)):Promise.resolve();class X{constructor(e=R){s(this,"namespace","");s(this,"secret","");s(this,"listeners",new Set);s(this,"state",{url:null,title:null,canGoBack:!1,loading:!1,progress:0});this.timings=e,this.rotateNonce()}rotateNonce(){this.namespace=`fz${L(8)}`,this.secret=L(16)}async ensureScript(){for(let e=0;e<2;e++){const t=j.split("__FZ_NS__").join(this.namespace).split("__FZ_SECRET__").join(this.secret);if(C(await this.evaluateRaw(t))==="ok")return;this.rotateNonce()}throw new Error("script di snapshot non iniettabile")}async invoke(e,...t){if(!this.isReady())return null;await this.ensureScript();const n=`window.${this.namespace}${e}(${t.map(i=>JSON.stringify(i)).join(", ")})`;return C(await this.evaluateRaw(`(function () { try { return ${n}; } catch (e) { return null; } })()`))}async snapshot(e){const t=await this.invoke("snapshot",{groupSelectors:(e==null?void 0:e.groupSelectors)??[]});if(!d(t))throw new Error("snapshot non disponibile");return q(t)}async describe(e){const t=await this.invoke("describe",e);return!d(t)||t.visible!==!0?null:V(t)}async click(e,t){return G(await this.invoke("click",e,t))}async scroll(e){await this.invoke("scroll",e)}async fillableFields(){const e=await this.invoke("fields");return Array.isArray(e)?e.map(z).filter(t=>t!==null):[]}async fill(e){if(e.length===0)return 0;const t=e.map(i=>({id:i.id,value:i.value,sig:i.signature})),n=await this.invoke("fill",t);return d(n)&&typeof n.filled=="number"?Math.trunc(n.filled):0}async runRecipe(e){const t=await this.invoke("recipe",e);return d(t)?t:null}async outline(){const e=await this.invoke("outline");return d(e)?e:null}async waitForIdle(e=1e4){await F(this.timings.settleBeforeMs),this.state.loading&&(await new Promise(t=>{const n=setTimeout(l,e),i=this.subscribe(a=>{(!this.state.loading||a.type==="loadError")&&l()});function l(){clearTimeout(n),i(),t()}}),await F(this.timings.settleAfterMs))}getState(){return{...this.state}}subscribe(e){return this.listeners.add(e),()=>{this.listeners.delete(e)}}emit(e){for(const t of[...this.listeners])try{t(e)}catch(n){console.error("[browser] listener",n)}}removeAllListeners(){this.listeners.clear()}}const Z=u.createContext(P);function Q(){return u.useContext(Z)}const h=new Map;function ue(){const r=Q(),{currentUser:e}=M(),t=(e==null?void 0:e.uid)??null,[n,i]=u.useState(0),[l,a]=u.useState(()=>r.configured?t&&h.get(t)||"checking":"not_configured");u.useEffect(()=>{if(!r.configured){a("not_configured");return}if(!t){a("checking");return}const p=h.get(t);if(p){a(p);return}const f=new AbortController;return a("checking"),r.access(f.signal).then(o=>{if(f.signal.aborted)return;const x=o.allowed?"allowed":"denied";h.set(t,x),a(x)}).catch(o=>{f.signal.aborted||((o==null?void 0:o.status)===403||(o==null?void 0:o.type)==="forbidden"?(h.set(t,"denied"),a("denied")):(o==null?void 0:o.type)==="not_configured"?a("not_configured"):a("error"))}),()=>f.abort()},[r,t,n]);const b=u.useCallback(()=>{t&&h.delete(t),i(p=>p+1)},[t]);return{access:l,uid:t,retry:b}}const E=D("SecureBrowser"),ee=["javascript","data","file","blob","content"];function te(r,e){var t,n;switch(r){case"cleartext":return"cleartextBlocked";case"sso":return"ssoProvider";case"scheme":{const i=((n=(t=/^([a-z][a-z0-9+.-]*):/i.exec(e.trim()))==null?void 0:t[1])==null?void 0:n.toLowerCase())??"";return ee.includes(i)||i===""?"forbiddenScheme":"externalScheme"}default:return"outsideAllowlist"}}const ne=(r,e)=>r.x===e.x&&r.y===e.y&&r.width===e.width&&r.height===e.height;class ie extends X{constructor(t){super(t.timings??R);s(this,"plugin");s(this,"options");s(this,"handles",[]);s(this,"opening",null);s(this,"opened",!1);s(this,"disposed",!1);s(this,"latestFrame",null);s(this,"latestVisible",!0);this.options=t,this.plugin=t.plugin??E}static isAvailable(){return S.getPlatform()==="android"&&S.isPluginAvailable("SecureBrowser")}open(t){return this.latestFrame??(this.latestFrame=t),this.opening??(this.opening=this.doOpen(t)),this.opening}async doOpen(t){const{provider:n}=this.options;if(await this.listen(),!this.disposed){this.state={...this.state,url:n.startUrl,loading:!0,progress:0};try{await this.plugin.open({url:n.startUrl,allowedHosts:[...n.allowedHosts],uaMode:n.desktopMode?"desktop":"strip",userAgent:this.options.userAgent,frame:t,secure:this.options.secure??!0,pageFinishedScript:this.options.pageFinishedScript,wideViewport:n.desktopMode,externalAppPackages:[...n.externalAppPackagePrefixes??[]]}),this.opened=!0;const i=this.latestFrame;!this.disposed&&i&&!ne(i,t)&&await this.plugin.setFrame(i),!this.disposed&&!this.latestVisible&&await this.plugin.setVisible({visible:!1})}catch(i){throw this.state={...this.state,loading:!1},i instanceof Error?i:new Error(String(i))}finally{this.disposed&&await this.plugin.close().catch(()=>{})}}}async listen(){const t=this.plugin;this.handles=await Promise.all([t.addListener("pageStarted",({url:n})=>{this.rotateNonce(),this.state={...this.state,url:n,loading:!0,progress:Math.min(this.state.progress,10)},this.emit({type:"pageStarted",url:n})}),t.addListener("pageFinished",({url:n})=>{this.state={...this.state,url:n,loading:!1,progress:100},this.emit({type:"pageFinished",url:n}),this.syncState()}),t.addListener("urlChanged",({url:n})=>{this.state={...this.state,url:n},this.syncState()}),t.addListener("titleChanged",({title:n})=>{this.state={...this.state,title:n},this.emit({type:"titleChanged",title:n})}),t.addListener("progress",({progress:n})=>{this.state={...this.state,progress:n},this.emit({type:"progress",progress:n})}),t.addListener("navigationBlocked",({url:n,reason:i})=>{this.emit({type:"navigationBlocked",url:n,verdict:te(i,n)})}),t.addListener("loadError",({url:n,code:i,description:l})=>{(i===null||i<0)&&(this.state={...this.state,loading:!1}),this.emit({type:"loadError",url:n,code:i,description:l})})])}async syncState(){if(!(!this.opened||this.disposed)){try{const t=await this.plugin.getState();this.state={...this.state,url:t.url??this.state.url,canGoBack:t.canGoBack,title:t.title??this.state.title}}catch{return}this.state.url&&this.emit({type:"urlChanged",url:this.state.url})}}isReady(){return this.opened&&!this.disposed}async evaluateRaw(t){if(!this.isReady())return null;const n=this.options.evaluateTimeoutMs??15e3;let i;const l=new Promise((a,b)=>{i=setTimeout(()=>b(new Error("la pagina non risponde")),n)});try{const{result:a}=await Promise.race([this.plugin.evaluate({script:t}),l]);return a}finally{clearTimeout(i)}}async navigate(t){var i,l;const n=((l=(i=this.options).checkNavigation)==null?void 0:l.call(i,t))??"allow";if(n!=="allow")throw this.emit({type:"navigationBlocked",url:t,verdict:n}),new Error(`navigazione bloccata (${n})`);if(!this.opened)throw new Error("browser non aperto");try{await this.plugin.loadUrl({url:t})}catch(a){throw new Error(`navigazione rifiutata: ${a instanceof Error?a.message:String(a)}`)}}async goBack(){if(!this.opened)return!1;const{wentBack:t}=await this.plugin.goBack();return t}async currentUrl(){if(!this.opened)return this.state.url;try{return(await this.plugin.getState()).url}catch{return this.state.url}}async setFrame(t){this.latestFrame=t,this.opened&&!this.disposed&&await this.plugin.setFrame(t)}async setVisible(t){this.latestVisible=t,this.opened&&!this.disposed&&await this.plugin.setVisible({visible:t})}async reload(){this.opened&&await this.plugin.reload()}async stopLoading(){this.opened&&await this.plugin.stopLoading()}async dispose(){if(this.disposed)return;this.disposed=!0,this.removeAllListeners();const t=this.handles;this.handles=[],await Promise.all(t.map(n=>n.remove().catch(()=>{}))),this.opened&&await this.plugin.close().catch(()=>{}),this.opened=!1}}async function de(r=E){return r===E&&!ie.isAvailable()?!1:(await r.clearSession(),!0)}export{ce as A,R as D,ie as N,X as S,oe as a,ue as b,de as c,Q as u};
