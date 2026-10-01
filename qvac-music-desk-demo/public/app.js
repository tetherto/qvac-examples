// QVAC MUSIC DESK - the client
// ---------------------------------------------------------------------------
// Two modes, one object underneath both of them.
//
//   Prompt  describe it in a sentence. Write the sheet expands it with a local
//           model; Surprise me hands the whole job to the music model's own LM.
//   Manual  pick presets and fill the fields, with no model in the loop.
//
// Both write the same sheet, so switching modes never loses work and a field you
// touched is never overwritten by an expansion.
//
// UI COPY RULE, after a round of feedback: no standing paragraphs. Explanation
// lives in a `title` on a help glyph, in a placeholder, or nowhere. A control
// the eye has to hunt for behind three lines of grey text is a worse control.
//
// The sheet is the shared artefact. That is the whole design: the friendly door
// has no ceiling, the expert door is not a mode you graduate into, and a field
// you have touched is never overwritten by an expansion.
//
// There is no engine switch. Every task that takes audio in is ACE-Step only,
// and on the one task where both engines work it is a speed trade, so the
// server routes and the top bar reports what ran, after the fact.
// ---------------------------------------------------------------------------

(function () {
  var $ = function (id) { return document.getElementById(id) }
  var el = function (tag, cls, html) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (html !== undefined) n.innerHTML = html
    return n
  }
  var icon = function (n, cls) { return '<svg class="icon' + (cls ? ' ' + cls : '') + '"><use href="#i-' + n + '"/></svg>' }
  var esc = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }

  // ---------- state ----------
  var st = {
    caps: null,
    writer: null,
    vocab: null,
    models: null,
    machine: null,
    library: [],
    takes: [],
    job: null,
    pending: 0,
    // Fields the person has edited. Never recomputed by an expansion.
    touched: {},
    reference: null,   // { kind, id, name }
    prefer: 'fast',
    mode: 'prompt',
    catalogue: null,
    download: null,
    sheetOpen: false,
    openVerb: null,    // { takeId, verb }
    range: null        // { takeId, from, to }
  }

  var audio = new Audio()
  var playing = null
  audio.addEventListener('ended', function () { playing = null; renderTakes() })

  function toast (msg) {
    $('toast-text').textContent = msg
    $('toast').hidden = false
    clearTimeout(toast._t)
    toast._t = setTimeout(function () { $('toast').hidden = true }, 9000)
  }

  function api (path, body) {
    return fetch(path, body === undefined ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status))
        return j
      })
    })
  }

  function secs (n) {
    if (n === null || n === undefined) return '-'
    var s = Math.round(n * 10) / 10
    if (s < 60) return s + ' s'
    return Math.floor(s / 60) + 'm ' + String(Math.round(s % 60)).padStart(2, '0') + 's'
  }

  // ============================================================
  // The sheet: reading it, writing it, and remembering what is yours
  // ============================================================

  function sheetFromForm () {
    var voices = $('has-voices').checked
    return {
      caption: $('caption').value.trim(),
      lyrics: voices ? $('lyrics').value : '[Instrumental]',
      instrumental: !voices,
      bpm: Number($('bpm').value) || 0,
      keyscale: $('keyscale').value,
      timesignature: $('timesignature').value,
      vocalLanguage: $('vocal-language').value,
      duration: Number($('duration').value)
    }
  }

  /**
   * Writes a sheet into the form, skipping anything the person has edited.
   * `force` is for a starter card, where the whole point is to replace what is
   * there.
   */
  function sheetToForm (sheet, force) {
    var keep = force ? {} : st.touched
    if (sheet.caption !== undefined && !keep.caption) $('caption').value = sheet.caption
    if (sheet.instrumental !== undefined && !keep.instrumental) {
      $('has-voices').checked = !sheet.instrumental
    }
    if (sheet.lyrics !== undefined && !keep.lyrics && sheet.lyrics !== '[Instrumental]') {
      $('lyrics').value = sheet.lyrics
    }
    if (sheet.bpm !== undefined && !keep.bpm) $('bpm').value = sheet.bpm
    if (sheet.keyscale !== undefined && !keep.keyscale) $('keyscale').value = sheet.keyscale
    if (sheet.timesignature !== undefined && !keep.timesignature) $('timesignature').value = sheet.timesignature
    if (sheet.vocalLanguage !== undefined && !keep.vocalLanguage) $('vocal-language').value = sheet.vocalLanguage
    if (sheet.duration !== undefined && !keep.duration) $('duration').value = sheet.duration
    if (force) st.touched = {}
    syncSheet()
  }

  /** Keeps the readouts, the voices switch and the length advice honest. */
  function syncSheet () {
    var voices = $('has-voices').checked
    $('voices-label').textContent = voices ? 'on' : 'off'
    $('lyrics-wrap').hidden = !voices
    $('lang-field').style.opacity = voices ? '1' : '0.5'
    $('vocal-language').disabled = !voices
    // A dead control with no reason is a dead end.
    $('vocal-language').title = voices ? '' : 'There is no singing to give a language to. Turn Voices on.'

    renderTagCount()

    var d = Number($('duration').value)
    $('duration-out').textContent = secs(d)
    // The authors' duration maths, as a tooltip rather than a paragraph.
    $('duration').title = d < 30 ? 'A clip, fine for a sting or a loop'
      : d < 120 ? 'Short for a song with verses. Two verses and two choruses want 120 s or more.'
        : d < 180 ? 'Room for two verses and two choruses'
          : d < 240 ? 'Room for a bridge as well'
            : 'A full production, intro and outro included'

    var bpm = Number($('bpm').value)
    $('bpm-out').textContent = bpm ? bpm + ' bpm' : 'let the model decide'
    var n = Number($('variations').value)
    $('variations-out').textContent = n
    $('variations').title = 'The model authors recommend two to four and pick from them'
    renderRenderButton()
    renderSheetSummary()
  }

  /**
   * The style is a keyword list, so the counter counts keywords. The authors'
   * range is 5 to 12, and past 15 they dilute each other, so the number goes
   * quiet inside the range and warns outside it. It used to count words, which
   * rewarded prose: sixteen words carrying four keywords read as plenty.
   */
  function renderTagCount () {
    var t = (st.vocab.tagTarget || { low: 5, high: 12, dilute: 15 })
    var n = $('caption').value.split(',').map(function (x) { return x.trim() }).filter(Boolean).length
    var out = $('caption-count')
    out.textContent = n ? n + (n === 1 ? ' keyword' : ' keywords') : ''
    out.classList.toggle('warn', n > 0 && (n < t.low || n > t.dilute))
    out.title = n < t.low ? 'Thin. ' + t.low + ' to ' + t.high + ' keywords works best'
      : n > t.dilute ? 'Past ' + t.dilute + ' keywords they dilute each other'
        : t.low + ' to ' + t.high + ' keywords works best'
  }

  /** The one line that stands in for the sheet while it is collapsed. */
  function renderSheetSummary () {
    var cap = $('caption').value.trim()
    var bits = []
    if (cap) bits.push(cap.length > 48 ? cap.slice(0, 48) + '...' : cap)
    bits.push(secs(Number($('duration').value)))
    if (Number($('bpm').value)) bits.push($('bpm').value + ' bpm')
    if ($('has-voices').checked) bits.push('voices')
    $('sheet-summary').textContent = cap ? bits.join('  ·  ') : 'empty'
  }

  /**
   * The button says how many takes it will make and roughly what that costs.
   * Three tracks appearing from one click reads as a bug when the button just
   * says "Make music". The factor is measured on this machine: ACE-Step turbo
   * runs at about 0.12x, MiniMax at about 4.4x.
   */
  function renderRenderButton () {
    var running = st.job && st.job.status === 'running'
    if (running) { $('render').textContent = 'Working'; return }
    // One primary action per state. With no style there is nothing to render, so
    // the render button steps down and says why, and writing the sheet is the
    // action. A dead enabled button that answers with a toast is a dead end.
    var hasStyle = !!$('caption').value.trim()
    $('do-expand').classList.toggle('primary', !hasStyle)
    $('render').disabled = !hasStyle
    $('render').title = hasStyle ? '' :
      'The sheet has no style yet. Write a brief above, or type a style into the sheet.'
    var n = Number($('variations').value) || 1
    var d = Number($('duration').value) || 60
    // Measured here, compute divided by audio length: turbo-q4 0.12 to 0.20,
    // the 50-step sft 0.56, MiniMax 4.4.
    var factor = st.prefer === 'vocals' ? 4.4 : st.prefer === 'detailed' ? 0.56 : 0.12
    var est = Math.round(n * d * factor)
    $('render').textContent = n === 1 ? 'Make one take' : 'Make ' + n + ' takes'
    if (hasStyle) {
      $('render').title = n + (n === 1 ? ' take' : ' takes') + ' of ' + secs(d) +
        ', roughly ' + secs(est) + ' of compute on this machine'
    }
    // Whenever nothing is running, the status line carries the estimate. Keying
    // this on `!st.job` left it stuck on "done" from the previous render, which
    // is the moment the estimate is most useful.
    $('prog-stage').textContent = !hasStyle ? 'the sheet needs a style'
      : n === 1 ? 'ready, about ' + secs(est)
      : 'ready, ' + n + ' takes of ' + secs(d) + ', about ' + secs(est)
  }

  /**
   * Five examples drawn from the pool, plus a chip that draws five more. Six
   * fixed titles under the brief read as a menu, and the brief accepts anything:
   * the pool exists to show how wide that is, not to constrain it. Five, not
   * six, because the titles vary in length and six wrapped the reroll chip onto
   * a line of its own.
   */
  function renderStarters () {
    var pool = (st.vocab.starters || []).slice()
    var pick = []
    while (pick.length < 5 && pool.length) {
      pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
    }
    $('starters').innerHTML = ''
    $('starters').appendChild(el('span', 'starters-label', 'Examples'))
    pick.forEach(function (item) {
      var b = el('button', 'starter', esc(item.title))
      b.title = item.brief
      b.onclick = function () {
        $('brief').value = item.brief
        $('brief').focus()
        renderSheetSummary()
        renderRenderButton()
      }
      $('starters').appendChild(b)
    })
    if ((st.vocab.starters || []).length > 5) {
      var more = el('button', 'chip-more', 'others')
      more.title = 'Draw five other examples. Anything you can describe works, these are only a start.'
      more.onclick = renderStarters
      $('starters').appendChild(more)
    }
  }

  /**
   * The loading state of the one button that has a wait behind it. It used to
   * write into a hint element that the paragraph purge deleted, which threw and
   * left the button disabled with nothing happening: the flow was dead and no
   * measurement of the page could see it, because nothing had been clicked.
   */
  function expandBusy (on) {
    var b = $('do-expand')
    b.disabled = on || !st.writer.available
    b.innerHTML = '<svg class="icon"><use href="#i-wand"/></svg> ' +
      (on ? 'Writing it' : 'Write the sheet')
  }

  /** Adds or removes one preset word from the caption. */
  function toggleWord (word) {
    var box = $('caption')
    var parts = box.value.split(',').map(function (x) { return x.trim() }).filter(Boolean)
    var at = parts.findIndex(function (x) { return x.toLowerCase() === word.toLowerCase() })
    if (at >= 0) parts.splice(at, 1)
    else parts.push(word)
    box.value = parts.join(', ')
    markTouched('caption')
    syncSheet()
    markPresets()
  }

  /** Shows only the words that match what is typed, and every one of them. */
  function filterRow (row, term) {
    var q = String(term || '').trim().toLowerCase()
    row.classList.toggle('filtering', !!q)
    Array.prototype.forEach.call(row.querySelectorAll('.chip-word'), function (b) {
      b.hidden = !!q && (b.getAttribute('data-w') || '').toLowerCase().indexOf(q) < 0
    })
    var more = row.querySelector('.chip-more')
    if (more) more.hidden = !!q
  }

  /**
   * Genre, voice and era are one-of. A row of chips for a one-of choice is a
   * radio group drawn as a wall, so they are selects, and picking one replaces
   * whatever word of that group was in the caption.
   */
  function setOneWord (group, word) {
    var box = $('caption')
    var lower = group.map(function (w) { return w.toLowerCase() })
    var parts = box.value.split(',').map(function (x) { return x.trim() }).filter(Boolean)
      .filter(function (x) { return lower.indexOf(x.toLowerCase()) < 0 })
    if (word) parts.push(word)
    box.value = parts.join(', ')
    markTouched('caption')
    syncSheet()
    markPresets()
  }

  /** Shows which preset words are currently in the caption. */
  function markPresets () {
    var cap = $('caption').value.toLowerCase()
    Array.prototype.forEach.call(document.querySelectorAll('#presets .chip-word'), function (b) {
      var w = (b.getAttribute('data-w') || '').toLowerCase()
      b.classList.toggle('on', cap.indexOf(w) >= 0)
    })
    Array.prototype.forEach.call(document.querySelectorAll('#presets select[data-group]'), function (sel) {
      var found = ''
      Array.prototype.forEach.call(sel.options, function (o) {
        if (o.value && cap.indexOf(o.value.toLowerCase()) >= 0) found = o.value
      })
      sel.value = found
    })
    // A chosen word hidden behind the count would be invisible and unremovable,
    // so its row opens and stays open.
    Array.prototype.forEach.call(document.querySelectorAll('#presets .preset-row'), function (row) {
      if (row.querySelector('.chip-word.extra.on')) {
        row.classList.add('all')
        var more = row.querySelector('.chip-more')
        if (more) more.textContent = 'less'
      }
    })
  }

  // Every edit marks its field. This is the promise that makes one sheet serve
  // both doors: the expander proposes, and anything you touched stays yours.
  function markTouched (key) { st.touched[key] = true; renderSheetNotes() }

  /**
   * Which fields are yours, as removable chips. This used to be a sentence
   * ending in a link, which is three lines of prose to say what four chips say
   * at a glance.
   */
  function renderSheetNotes () {
    var box = $('kept')
    var touched = Object.keys(st.touched)
    box.hidden = !touched.length
    if (!touched.length) return
    box.innerHTML = '<span class="kept-label">yours</span>'
    touched.forEach(function (k) {
      var b = el('button', 'kept-chip', esc(LABEL[k] || k) + ' ' + icon('x'))
      b.title = 'Release ' + (LABEL[k] || k) + ', so an expansion may rewrite it'
      b.onclick = function () { delete st.touched[k]; renderSheetNotes() }
      box.appendChild(b)
    })
  }
  var LABEL = { caption: 'style', lyrics: 'lyrics', bpm: 'tempo', keyscale: 'key',
    timesignature: 'time', duration: 'length', vocalLanguage: 'language', instrumental: 'voices' }

  // ============================================================
  // Static controls, populated from the server's vocabulary
  // ============================================================

  function fillStatics () {
    var v = st.vocab

    renderStarters()

    var keys = $('keyscale')
    keys.innerHTML = ''
    v.keys.forEach(function (k) {
      keys.appendChild(el('option', null, k || 'let the model decide')).value = k
    })
    var sig = $('timesignature')
    sig.innerHTML = ''
    v.timeSignatures.forEach(function (t) {
      sig.appendChild(el('option', null, esc(t[1]))).value = t[0]
    })
    var lang = $('vocal-language')
    lang.innerHTML = ''
    v.languages.forEach(function (l) {
      lang.appendChild(el('option', null, esc(l[1]))).value = l[0]
    })

    // The presets, by the shape of the choice rather than all as chips.
    //
    // Five rows of six chips is thirty equal-weight options on one screen, which
    // is an unsorted list and not an interface. Genre, mood and voice are one-of,
    // so they are selects. Instruments and texture are genuinely multi-pick, so
    // they stay chips: five visible, the rest behind a count. See
    // .claude/skills/ui-ux-bible, and note that in Prompt mode the whole block
    // is hidden, because there the model writes the style.
    var VISIBLE = 5
    $('presets').innerHTML = ''

    var picks = el('div', 'preset-picks')
    v.chips.filter(function (g) { return g[2] === 'one' }).forEach(function (g) {
      var id = 'pick-' + g[0].toLowerCase()
      var f = el('div', 'field')
      var lab = el('label', null, esc(g[0]))
      lab.setAttribute('for', id)
      var sel = el('select')
      sel.id = id
      sel.setAttribute('data-group', g[0])
      sel.appendChild(el('option', null, 'any')).value = ''
      g[1].forEach(function (word) { sel.appendChild(el('option', null, esc(word))).value = word })
      sel.onchange = function () { setOneWord(g[1], sel.value) }
      f.appendChild(lab)
      f.appendChild(sel)
      picks.appendChild(f)
    })
    if (picks.childNodes.length) $('presets').appendChild(picks)

    v.chips.filter(function (g) { return g[2] !== 'one' }).forEach(function (g) {
      var name = g[0]
      var words = g[1]
      var row = el('div', 'preset-row')
      row.appendChild(el('span', 'preset-label', esc(name)))
      var wrap = el('div', 'preset-chips')
      // Fifty-nine instruments cannot be a row of chips and cannot be a select
      // either. Typing "guit" and seeing the four guitars is the control for a
      // list this long: the five likely ones stay visible until you type.
      if (words.length > 12) {
        var f = el('input', 'chip-filter')
        f.type = 'search'
        f.placeholder = 'filter'
        f.setAttribute('aria-label', 'Filter ' + name.toLowerCase())
        f.oninput = function () { filterRow(row, f.value) }
        wrap.appendChild(f)
      }
      words.forEach(function (word, i) {
        var b = el('button', 'chip-word' + (i >= VISIBLE ? ' extra' : ''), esc(word))
        b.setAttribute('data-w', word)
        b.onclick = function () { toggleWord(word) }
        wrap.appendChild(b)
      })
      if (words.length > VISIBLE) {
        var more = el('button', 'chip-more', '+' + (words.length - VISIBLE))
        more.title = 'Show the other ' + (words.length - VISIBLE) + ' ' + name.toLowerCase() + ' words'
        more.onclick = function () {
          var open = row.classList.toggle('all')
          more.textContent = open ? 'less' : '+' + (words.length - VISIBLE)
        }
        wrap.appendChild(more)
      }
      row.appendChild(wrap)
      $('presets').appendChild(row)
    })
    markPresets()

    // Structure tags, from the list the server's translator actually knows.
    // Same shape as the vocabulary above it: an eyebrow, five tags, the rest
    // behind a count. Three full rows of these was twenty-nine equal chips over
    // the lyrics box, which is the wall this app keeps growing back.
    var bar = $('tagbar')
    bar.innerHTML = ''
    var groups = [['Sections', v.sections.acestep], ['Voice', v.colourTags.voice], ['Energy', v.colourTags.energy]]
    groups.forEach(function (g) {
      var row = el('div', 'preset-row')
      row.appendChild(el('span', 'preset-label', esc(g[0])))
      var wrap = el('div', 'preset-chips')
      g[1].forEach(function (t, i) {
        var b = el('button', 'tag' + (i >= VISIBLE ? ' extra' : ''), '[' + esc(t) + ']')
        b.onclick = function () {
          var box = $('lyrics')
          var at = box.selectionStart === undefined ? box.value.length : box.selectionStart
          var tag = '[' + t + ']\n'
          box.value = box.value.slice(0, at) + tag + box.value.slice(at)
          box.focus()
          box.selectionStart = box.selectionEnd = at + tag.length
          markTouched('lyrics')
        }
        wrap.appendChild(b)
      })
      if (g[1].length > VISIBLE) {
        var more = el('button', 'chip-more', '+' + (g[1].length - VISIBLE))
        more.title = 'Show the other ' + (g[1].length - VISIBLE) + ' ' + g[0].toLowerCase() + ' tags'
        more.onclick = function () {
          var open = row.classList.toggle('all')
          more.textContent = open ? 'less' : '+' + (g[1].length - VISIBLE)
        }
        wrap.appendChild(more)
      }
      row.appendChild(wrap)
      bar.appendChild(row)
    })

    // Voice quality: the ONE place the two engines are a real choice, framed as
    // what the person hears rather than as a model name.
    // Quality is mostly which generator runs, and the desk used to ignore that:
    // every render went through the 4-bit 8-step draft variant. The 50-step one
    // is the reference, and it is the only one where guidance does anything.
    var mmReady = st.models.minimax.ready && st.models.minimax.supported
    var dits = st.models.acestep.dits || {}
    var detailed = !!(dits.sft || dits['turbo-q8'])
    $('prefer').innerHTML = ''
    ;[['fast', 'Fast', '8 steps'], ['detailed', 'Detailed', '50 steps'], ['vocals', 'Richer vocals', 'MiniMax']]
      .forEach(function (o) {
        var b = el('button', 'seg-btn' + (st.prefer === o[0] ? ' on' : ''),
          esc(o[1]) + '<em>' + esc(o[2]) + '</em>')
        if (o[0] === 'vocals' && !mmReady) {
          b.disabled = true
          b.title = 'Needs MiniMax-Music3, which you supply yourself. Info panel.'
        } else if (o[0] === 'detailed' && !detailed) {
          b.disabled = true
          b.title = 'Needs the 50-step generator, 2.5 GB. Get it in the Info panel.'
        } else {
          b.title = o[0] === 'fast' ? 'The 8-step generator. About eight times faster and the one to sketch with.'
            : o[0] === 'detailed' ? 'The 50-step generator, the quality reference. Roughly six times the compute.'
              : 'MiniMax-Music3, stronger singing, about thirty times the compute.'
        }
        b.onclick = function () { st.prefer = o[0]; fillStatics(); syncSheet() }
        $('prefer').appendChild(b)
      })
    $('prefer-help').title = !mmReady
      ? 'Richer vocals needs the MiniMax weights, which are not on this machine'
      : 'Fast is ACE-Step, measured here at 0.12 to 0.29x the audio length. Richer vocals is MiniMax-Music3 at about 4.4x, so a 30 s clip takes about 2 minutes.'

    renderAdvanced()
    $('do-expand').disabled = !st.writer.available
    $('brief-warn').hidden = st.writer.available
    if (!st.writer.available) {
      $('brief-warn').textContent = 'no writing model, use Surprise me'
      $('brief-warn').title = st.writer.why
    }
  }

  /**
   * Advanced, built from what the addon says it accepts rather than from a list
   * in this file. The old desk hard-coded that list and it went stale the moment
   * the dependency's caret resolved to a new release.
   */
  /**
   * Advanced, built from what the addon says it accepts rather than from a list
   * in this file. Every explanation is a tooltip: this panel used to carry six
   * paragraphs of grey text over the controls it was describing.
   */
  function renderAdvanced () {
    var engine = st.prefer === 'vocals' ? 'minimax' : 'acestep'
    var accepts = function (k) { return !st.caps || st.caps.accepts[engine][k] !== false }
    var rows = []

    rows.push(row('Loudness',
      '<label class="check"><input type="checkbox" id="adv-norm" checked> normalize</label>',
      'On by default in the engine. Off gives the raw output. Audio edits are never normalized either way.'))

    if (accepts('guidanceScale')) {
      rows.push(row('Guidance',
        '<input type="number" id="adv-guidance" min="0" max="10" step="0.5" placeholder="auto">',
        '0 or blank resolves itself: 1.0 on a turbo DiT, 7.0 on base or sft. Above 1 doubles the cost per step.'))
    }
    if (accepts('inferenceSteps')) {
      rows.push(row('Steps',
        '<input type="number" id="adv-steps" min="0" max="200" step="1" placeholder="model default">',
        'Diffusion steps. Blank uses the model default.'))
    }
    if (accepts('cfgScale')) {
      rows.push(row('Flow guidance',
        '<input type="number" id="adv-cfg" min="0" max="10" step="0.1" placeholder="model default">', ''))
    }
    if (accepts('lmTemperature')) {
      rows.push(row('Songwriter',
        '<div class="row"><input type="number" id="adv-lmtemp" min="0" max="2" step="0.05" placeholder="0.85"><input type="number" id="adv-lmtopp" min="0" max="1" step="0.05" placeholder="0.9"></div>',
        'Temperature and top-p for the arrangement stage. Blank leaves the engine\'s own 0.85 and 0.9.'))
    }
    if (accepts('dcwEnabled')) {
      rows.push(row('Haar correction',
        '<label class="check"><input type="checkbox" id="adv-dcw"> show it</label>',
        'Haar DCW correction, already on inside the engine at these strengths. Here so you can see them.'))
    }
    if (accepts('augmentCaptionWithMetadata')) {
      rows.push(row('Repeat tempo in style',
        '<label class="check"><input type="checkbox" id="adv-augment"> repeat it</label>',
        'The ACE-Step authors list a tempo in the style text under things not to do, so this is off. Unmeasured either way.'))
    }

    var formats = (st.caps ? st.caps.formats : ['wav'])
    var common = st.vocab.commonFormats
    rows.push(row('Also write',
      common.map(function (f) {
        return '<label class="check"><input type="checkbox" class="fmt" value="' + f + '"' +
          (f === 'wav' ? ' checked disabled title="wav is always written"' : '') + '> ' + f + '</label>'
      }).join('') +
      '<details class="more"><summary>more</summary><div class="preset-chips">' +
      formats.filter(function (f) { return common.indexOf(f) < 0 }).map(function (f) {
        return '<label class="check"><input type="checkbox" class="fmt" value="' + f + '"> ' + f + '</label>'
      }).join('') + '</div></details>',
      'wav is always written. There is no mp3: the vendored ffmpeg has no LAME encoder.'))

    $('adv-body').innerHTML = rows.join('')

    function row (label, control, tip) {
      return '<div class="adv-row"><div class="adv-label">' + esc(label) +
        (tip ? ' <button type="button" class="help" aria-label="What this means" title="' + esc(tip) + '"><svg class="icon"><use href="#i-help"/></svg></button>' : '') +
        '</div><div class="adv-control">' + control + '</div></div>'
    }
  }

  function advancedFromForm () {
    var num = function (id) { var n = $(id); return n && n.value !== '' ? Number(n.value) : undefined }
    return {
      normalizeLoudness: $('adv-norm') ? $('adv-norm').checked : true,
      guidanceScale: num('adv-guidance'),
      inferenceSteps: num('adv-steps'),
      cfgScale: num('adv-cfg'),
      lmTemperature: num('adv-lmtemp'),
      lmTopP: num('adv-lmtopp'),
      dcw: $('adv-dcw') ? $('adv-dcw').checked : false,
      augment: $('adv-augment') ? $('adv-augment').checked : false
    }
  }

  function formatsFromForm () {
    var out = ['wav']
    Array.prototype.forEach.call(document.querySelectorAll('.fmt'), function (c) {
      if (c.checked && out.indexOf(c.value) < 0) out.push(c.value)
    })
    return out
  }

  // ============================================================
  // Library and the reference slot
  // ============================================================

  function renderLibrary () {
    var list = $('lib-list')
    list.innerHTML = ''
    st.library.forEach(function (item) {
      var isRef = st.reference && st.reference.id === item.id
      var li = el('li', 'lib-item' + (isRef ? ' on' : ''))
      li.innerHTML = '<span class="lib-name">' + esc(item.name) + '</span>' +
        '<span class="quiet">' + secs(item.seconds) + '</span>'
      var ref = el('button', 'link standalone', isRef ? 'reference' : 'use as reference')
      ref.onclick = function () {
        st.reference = isRef ? null : { kind: 'library', id: item.id, name: item.name }
        renderLibrary()
      }
      var cov = el('button', 'link standalone', 'cover it')
      cov.onclick = function () { coverFrom({ kind: 'library', id: item.id }, item.name) }
      li.appendChild(ref)
      li.appendChild(cov)
      list.appendChild(li)
    })
    if (st.reference) {
      var note = el('li', 'lib-note', 'Reference timbre: <b>' + esc(st.reference.name) + '</b>. It will condition the next render.')
      list.appendChild(note)
    }
  }

  /**
   * One request per file, raw bytes with the name in a header, because that is
   * what the server reads. ffmpeg converts it to the interleaved stereo 48 kHz
   * float the engine accepts, and it happens now rather than at render time so
   * a file that cannot be read fails while you are still looking at it.
   */
  function upload (files) {
    if (!files || !files.length) return
    Array.prototype.reduce.call(files, function (chain, f) {
      return chain.then(function () {
        return fetch('/api/import', {
          method: 'POST',
          headers: { 'x-filename': f.name.replace(/[^\w.\-]+/g, '_') },
          body: f
        }).then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status))
            if (j.item.engineReady === false) {
              toast(f.name + ' imported, but the engine cannot use it: ' + j.item.error)
            }
          })
        })
      })
    }, Promise.resolve()).catch(function (e) { toast('Could not import that: ' + e.message) })
  }

  // ============================================================
  // Takes, and the verbs on them
  // ============================================================

  function renderTakes () {
    $('takes-count').textContent = st.takes.length
      ? st.takes.length + (st.pending ? ' plus ' + st.pending + ' queued' : '')
      : ''
    var box = $('takes-list')
    box.innerHTML = ''

    if (!st.takes.length) {
      box.appendChild(el('div', 'empty', 'Nothing yet'))
      return
    }

    st.takes.forEach(function (t) {
      var wav = (t.files || []).find(function (f) { return f.format === 'wav' })
      var card = el('div', 'take' + (t.level && t.level.silent ? ' bad' : ''))
      var v = t.variation
      var dur = t.stats && t.stats.audioDurationMs ? t.stats.audioDurationMs / 1000 : null

      card.appendChild(el('div', 'take-head',
        '<span class="take-title">' + esc(t.sheet && t.sheet.caption ? t.sheet.caption.slice(0, 64) : t.caption.slice(0, 64)) + '</span>' +
        '<span class="quiet">' + (v ? 'take ' + v.index + ' of ' + v.of + ' &middot; ' : '') + secs(dur) + '</span>'))

      var wrapRow = el('div', 'take-row')
      var pb = el('button', 'btn icon' + (playing === (wav && wav.file) ? ' on' : ''),
        icon(playing === (wav && wav.file) ? 'pause' : 'play'))
      pb.onclick = function () { play(wav && wav.file) }
      wrapRow.appendChild(pb)
      var cv = el('canvas', 'wave')
      cv.setAttribute('data-file', wav ? wav.file : '')
      cv.setAttribute('data-take', t.id)
      wrapRow.appendChild(cv)
      card.appendChild(wrapRow)

      if (st.range && st.range.takeId === t.id) {
        card.appendChild(el('div', 'range-note',
          'Selected ' + st.range.from.toFixed(1) + ' s to ' + st.range.to.toFixed(1) + ' s'))
      }

      var meta = []
      if (t.level) meta.push('peak ' + t.level.peakDb + ' dB')
      if (t.stats && t.stats.realTimeFactor) meta.push(t.stats.realTimeFactor.toFixed(2) + 'x compute')
      meta.push(t.engine === 'minimax' ? 'MiniMax-Music3' : 'ACE-Step')
      card.appendChild(el('div', 'take-meta', meta.join(' &middot; ')))

      if (t.level && t.level.silent) {
        card.appendChild(el('div', 'take-warn', icon('warn') + ' This take is silent. Try another seed.'))
      }
      if (t.level && t.level.clipped) {
        card.appendChild(el('div', 'take-warn', icon('warn') + ' Peaks at full scale, so it may be clipped.'))
      }
      if (t.notes && t.notes.length) {
        card.appendChild(el('div', 'take-warn', icon('info') + ' ' + t.notes.map(esc).join('. ')))
      }

      // The verbs. Every ACE-Step operation is here, and none of them is called
      // by its API name.
      var verbs = el('div', 'verbs')
      verb(verbs, 'More like this', function () { moreLikeThis(t) }, true)
      verb(verbs, 'Make it longer', function () { openVerb(t.id, 'extend') })
      verb(verbs, 'Change this part', function () { openVerb(t.id, 'repaint') })
      verb(verbs, 'Restyle it', function () { openVerb(t.id, 'flow') })
      verb(verbs, 'Cover it', function () { openVerb(t.id, 'cover') })
      verb(verbs, 'Use as reference', function () {
        st.reference = { kind: 'take', id: t.id, name: 'take ' + t.id.slice(0, 6) }
        renderLibrary()
        toast('That take will condition the next render as a reference timbre.')
      })
      var stemBtn = verb(verbs, 'Pull out a stem', function () { openVerb(t.id, 'stem') })
      // Lego needs the base DiT, and the addon's own README says it is not in the
      // registry variant set, so it has to be supplied as a path. Say so on the
      // button rather than failing after a click.
      if (!hasBaseDit()) {
        stemBtn.disabled = true
        stemBtn.title = 'Stems need the ACE-Step base DiT. Only ' +
          Object.keys(st.models.acestep.dits).join(', ') + ' is on this machine, and the base DiT is not in the addon registry.'
      }
      if (wav) {
        var dl = el('a', 'verb', 'Download')
        dl.href = '/api/audio/out/' + encodeURIComponent(wav.file)
        dl.setAttribute('download', '')
        verbs.appendChild(dl)
      }
      card.appendChild(verbs)

      if (st.openVerb && st.openVerb.takeId === t.id) {
        card.appendChild(verbPanel(t, st.openVerb.verb))
      }

      box.appendChild(card)
    })

    Array.prototype.forEach.call(document.querySelectorAll('canvas.wave'), drawWave)

    function verb (parent, label, fn, primary) {
      var b = el('button', 'verb' + (primary ? ' pri' : ''), label)
      b.onclick = fn
      parent.appendChild(b)
      return b
    }
  }

  /** QWEN3_4B_Q4_K_M is a filename, not a name a person should read. */
  function prettyModel (n) {
    if (!n) return 'none'
    var m = /^QWEN3_(\d+)(?:_(\d+))?B?_/.exec(n)
    if (m) return 'Qwen3 ' + m[1] + (m[2] ? '.' + m[2] : '') + 'B'
    return String(n).replace(/_/g, ' ')
  }

  function hasBaseDit () {
    return Object.keys(st.models.acestep.dits || {}).some(function (k) { return /base/i.test(k) })
  }

  function openVerb (takeId, verb) {
    st.openVerb = st.openVerb && st.openVerb.takeId === takeId && st.openVerb.verb === verb
      ? null
      : { takeId: takeId, verb: verb }
    renderTakes()
  }

  /** The little form each verb needs, inline on the take it applies to. */
  function verbPanel (take, verb) {
    var p = el('div', 'verb-panel')
    var source = { kind: 'take', id: take.id }
    var sheet = take.sheet || { caption: take.caption }

    if (verb === 'extend') {
      p.innerHTML = '<h4 title="Silence is appended and the engine fills it, conditioned on the music before it. It resolves rather than continues, so expect an ending. Go in short steps.">Make it longer <button type="button" class="help" aria-label="What this means"><svg class="icon"><use href="#i-help"/></svg></button></h4>' +
        '<div class="row"><input type="number" id="v-sec" value="8" min="1" max="60" step="1" title="seconds to add">' +
        '<input type="text" id="v-cap" placeholder="the new part" value="' + esc(sheet.caption) + '"></div>'
      go(p, function () {
        return { task: 'extend', sheet: sheet, source: source,
          op: { seconds: Number($('v-sec').value), caption: $('v-cap').value, mode: 'Balanced', strength: 0.5 } }
      })
    } else if (verb === 'repaint') {
      var r = st.range && st.range.takeId === take.id ? st.range : null
      p.innerHTML = '<h4>Change this part <em>' + (r
        ? r.from.toFixed(1) + ' s to ' + r.to.toFixed(1) + ' s'
        : 'drag the waveform first') + '</em></h4>' +
        '<input type="text" id="v-cap" placeholder="what happens there, e.g. analog synth solo">'
      go(p, function () {
        if (!r) throw new Error('Drag across the waveform to choose a range first.')
        return { task: 'repaint', sheet: sheet, source: source,
          op: { start: r.from, end: r.to, caption: $('v-cap').value || sheet.caption, mode: 'Balanced', strength: 0.5 } }
      })
    } else if (verb === 'flow') {
      p.innerHTML = '<h4 title="The whole track is rewritten from one description to another.">Restyle it <button type="button" class="help" aria-label="What this means"><svg class="icon"><use href="#i-help"/></svg></button></h4>' +
        '<input type="text" id="v-from" value="' + esc(sheet.caption) + '" title="from">' +
        '<input type="text" id="v-to" placeholder="to, e.g. dark synthwave">'
      go(p, function () {
        if (!$('v-to').value.trim()) throw new Error('Say what the new style should be.')
        return { task: 'flow-edit', sheet: sheet, source: source,
          op: { fromCaption: $('v-from').value, toCaption: $('v-to').value } }
      })
    } else if (verb === 'cover') {
      p.innerHTML = '<h4 title="Keeps the structure of this take and applies a new style. The three strengths are the model authors\' own numbers: 0.4, 0.6, 0.8.">Cover it <button type="button" class="help" aria-label="What this means"><svg class="icon"><use href="#i-help"/></svg></button></h4>' +
        '<input type="text" id="v-cap" placeholder="the new style">' +
        '<div class="seg" id="v-strength">' + st.vocab.coverStrengths.map(function (c, i) {
          return '<button class="seg-btn' + (i === 1 ? ' on' : '') + '" data-k="' + c.key + '">' +
            esc(c.label) + '<em>' + esc(c.hint) + '</em></button>'
        }).join('') + '</div>'
      var picked = { k: 'moderate' }
      setTimeout(function () {
        Array.prototype.forEach.call(p.querySelectorAll('#v-strength .seg-btn'), function (b) {
          b.onclick = function () {
            picked.k = b.getAttribute('data-k')
            Array.prototype.forEach.call(p.querySelectorAll('#v-strength .seg-btn'), function (o) { o.classList.remove('on') })
            b.classList.add('on')
          }
        })
      }, 0)
      go(p, function () {
        if (!$('v-cap').value.trim()) throw new Error('Say what style to cover it in.')
        return { task: 'cover', sheet: { caption: $('v-cap').value, instrumental: sheet.instrumental, lyrics: sheet.lyrics },
          source: source, coverStrength: picked.k }
      })
    } else if (verb === 'stem') {
      p.innerHTML = '<h4 title="Generates one isolated layer that follows this take.">Pull out a stem <button type="button" class="help" aria-label="What this means"><svg class="icon"><use href="#i-help"/></svg></button></h4>' +
        '<div class="preset-chips">' + (st.caps ? st.caps.legoTracks : []).map(function (t, i) {
          return '<button class="chip-word' + (i === 0 ? ' on' : '') + '" data-t="' + t + '">' + t.replace('_', ' ') + '</button>'
        }).join('') + '</div>'
      var track = { t: (st.caps && st.caps.legoTracks[0]) || 'drums' }
      setTimeout(function () {
        Array.prototype.forEach.call(p.querySelectorAll('.chip-word'), function (b) {
          b.onclick = function () {
            track.t = b.getAttribute('data-t')
            Array.prototype.forEach.call(p.querySelectorAll('.chip-word'), function (o) { o.classList.remove('on') })
            b.classList.add('on')
          }
        })
      }, 0)
      go(p, function () {
        return { task: 'stem', sheet: sheet, source: source, track: track.t }
      })
    }
    return p

    function go (parent, build) {
      var b = el('button', 'btn primary', 'Go')
      b.onclick = function () {
        var req
        try { req = build() } catch (e) { return toast(e.message) }
        req.variations = 1
        req.formats = formatsFromForm()
        req.advanced = advancedFromForm()
        st.openVerb = null
        render(req)
      }
      parent.appendChild(b)
    }
  }

  function moreLikeThis (take) {
    var sheet = take.sheet
    if (!sheet) return toast('That take has no sheet to reuse.')
    sheetToForm(sheet, true)
    render({
      task: 'compose',
      sheet: sheet,
      prefer: st.prefer,
      variations: Number($('variations').value) || 3,
      formats: formatsFromForm(),
      advanced: advancedFromForm(),
      reference: st.reference
    })
  }

  function coverFrom (source, name) {
    var cap = $('caption').value.trim()
    if (!cap) return toast('Write a style in the sheet first: that is what it will be covered as.')
    render({
      task: 'cover',
      sheet: sheetFromForm(),
      source: source,
      coverStrength: 'moderate',
      variations: 1,
      formats: formatsFromForm(),
      advanced: advancedFromForm()
    })
    toast('Covering ' + name + ' in the style on the sheet.')
  }

  // ---------- the waveform, and dragging a range on it ----------
  function drawWave (canvas) {
    var file = canvas.getAttribute('data-file')
    var takeId = canvas.getAttribute('data-take')
    if (!file || canvas.dataset.drawn) return
    canvas.dataset.drawn = '1'
    var w = canvas.clientWidth || 300
    var dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = 46 * dpr
    var ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    fetch('/api/audio/out/' + encodeURIComponent(file))
      .then(function (r) { return r.arrayBuffer() })
      .then(function (buf) { return new (window.AudioContext || window.webkitAudioContext)().decodeAudioData(buf) })
      .then(function (ab) {
        canvas.dataset.seconds = ab.duration
        var ch = ab.getChannelData(0)
        var per = Math.floor(ch.length / w) || 1
        var peaks = []
        for (var x = 0; x < w; x++) {
          var peak = 0
          for (var i = x * per; i < (x + 1) * per && i < ch.length; i++) {
            var a = Math.abs(ch[i])
            if (a > peak) peak = a
          }
          peaks.push(peak)
        }
        canvas._peaks = peaks
        paint()

        // Dragging a range beats two numeric fields: you choose the part you
        // just heard, on the picture of it.
        var dragging = null
        canvas.onmousedown = function (e) {
          dragging = xToSec(e)
          st.range = { takeId: takeId, from: dragging, to: dragging }
          paint()
        }
        canvas.onmousemove = function (e) {
          if (dragging === null) return
          var at = xToSec(e)
          st.range = { takeId: takeId, from: Math.min(dragging, at), to: Math.max(dragging, at) }
          paint()
        }
        window.addEventListener('mouseup', function () {
          if (dragging === null) return
          dragging = null
          if (st.range && st.range.to - st.range.from < 0.2) st.range = null
          renderTakes()
        })

        function xToSec (e) {
          var r = canvas.getBoundingClientRect()
          var frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
          return frac * ab.duration
        }

        function paint () {
          ctx.clearRect(0, 0, w, 46)
          var sel = st.range && st.range.takeId === takeId ? st.range : null
          if (sel) {
            ctx.fillStyle = 'rgba(22,227,193,0.14)'
            ctx.fillRect((sel.from / ab.duration) * w, 0, ((sel.to - sel.from) / ab.duration) * w, 46)
          }
          for (var x = 0; x < peaks.length; x++) {
            var inSel = sel && (x / w) * ab.duration >= sel.from && (x / w) * ab.duration <= sel.to
            ctx.fillStyle = inSel ? '#16e3c1' : 'rgba(22,227,193,0.55)'
            var h = Math.max(1, peaks[x] * 21)
            ctx.fillRect(x, 23 - h, 1, h * 2)
          }
        }
      })
      .catch(function () {
        ctx.fillStyle = '#5a5c5b'
        ctx.fillRect(0, 22, w, 1)
      })
  }

  /**
   * An <audio> that cannot reach the server says "no supported source was
   * found", which reads as a broken file and is not. That message sent a real
   * diagnosis down the wrong path, so the failure is asked what it actually is
   * before it gets to say anything.
   */
  function play (file) {
    if (!file) return
    if (playing === file && !audio.paused) { audio.pause(); playing = null; return renderTakes() }
    var url = '/api/audio/out/' + encodeURIComponent(file)
    audio.src = url
    audio.play().catch(function (e) {
      fetch(url, { method: 'HEAD' })
        .then(function (r) {
          if (r.ok) toast('That file will not decode: ' + e.message)
          else if (r.status === 404) toast('That audio is gone from the out folder.')
          else toast('The server answered ' + r.status + ' for that file.')
        })
        .catch(function () { toast('The desk server is not answering. Is it still running?') })
    })
    playing = file
    renderTakes()
  }

  // ============================================================
  // Rendering
  // ============================================================

  function render (req) {
    api('/api/render', req)
      .then(function () { renderTransport() })
      .catch(function (e) { toast(e.message) })
  }

  function renderTransport () {
    var j = st.job
    var running = j && j.status === 'running'
    $('render').disabled = running
    $('cancel').hidden = !running
    renderRenderButton()

    if (!j) { $('prog-count').textContent = ''; $('bar').style.width = '0%'; return }

    var label = { lm: 'writing the arrangement', dit: 'generating audio', vae: 'decoding' }[j.stage] || j.stage || 'loading the model'
    var pre = j.variation && j.variation.of > 1 ? 'take ' + j.variation.index + ' of ' + j.variation.of + ': ' : ''
    // A finished render already announced itself: the take is in the list. So the
    // status line goes back to costing the next one, which is the useful thing to
    // read. Only a running job or a failure gets to hold it.
    if (running) $('prog-stage').textContent = pre + label
    else if (j.status === 'failed') $('prog-stage').textContent = 'failed: ' + (j.error || 'unknown')
    else if (j.status === 'cancelled') $('prog-stage').textContent = 'cancelled'
    $('prog-count').textContent = st.pending ? st.pending + ' queued' : (j.total ? j.step + ' / ' + j.total : '')
    // Indeterminate until there is a real total: a bar parked on one number
    // reads as a dead run.
    $('bar').className = 'bar-fill' + (running && !j.total ? ' pulse' : '')
    $('bar').style.width = running ? (j.total ? Math.round((j.step / j.total) * 100) + '%' : '100%') : '0%'

    $('engine-chip').textContent = j.engine === 'minimax' ? 'MiniMax-Music3' : 'ACE-Step 1.5'
  }

  // ---------- models: what is here, and what the desk can fetch ----------

  function gb (b) { return b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : Math.round(b / 1e6) + ' MB' }

  /**
   * What each file is FOR. A row used to read `Qwen3-Embedding-0.6B-Q8_0.gguf`,
   * which tells a person nothing they can act on. The filename moves to the
   * tooltip, where it is still there for anyone who needs it.
   */
  var ROLE = {
    textEncModel: 'Text encoder',
    lmModel: 'Songwriter',
    vaeModel: 'Audio decoder',
    'dit:turbo-q4': 'Generator, fast',
    'dit:turbo-q8': 'Generator, precise',
    'dit:sft': 'Generator, 50 steps',
    writer: 'Brief expander'
  }

  function loadCatalogue () {
    return fetch('/api/models/catalogue').then(function (r) { return r.json() })
      .then(function (c) { st.catalogue = c; renderDetail(); renderBanner() })
      .catch(function () {})
  }

  function downloadKeys (keys, label) {
    api('/api/models/download', { keys: keys })
      .then(function (r) { if (r.nothing) toast('Already on this machine.') })
      .catch(function (e) { toast(e.message) })
    if (label) toast('Fetching ' + label + '. It lands in ~/.qvac/models and is reused by every QVAC app.')
  }

  /**
   * The banner. Without the ACE-Step stages the desk cannot make a sound, so
   * that fact belongs on the screen with the button that fixes it, not in a
   * README.
   */
  function renderBanner () {
    var host = $('stage-scroll')
    var old = $('banner')
    if (old) old.remove()
    if (!st.models || st.models.acestep.ready) return
    var cat = st.catalogue
    var missing = cat && cat.items ? cat.items.filter(function (i) { return i.essential && !i.onDisk }) : []
    var bytes = missing.reduce(function (a, i) { return a + i.bytes }, 0)
    var b = el('div', 'banner')
    b.id = 'banner'
    b.innerHTML = '<b>No music model on this machine yet.</b>'
    if (missing.length) {
      var btn = el('button', 'btn primary', 'Download ' + gb(bytes))
      btn.onclick = function () { downloadKeys(missing.map(function (i) { return i.key }), 'the music model') }
      b.appendChild(btn)
    }
    var info = el('button', 'link standalone', 'see all models')
    info.onclick = function () { $('detail').hidden = false }
    b.appendChild(info)
    host.insertBefore(b, host.firstChild)
  }

  /** One model row: role, size, and either a state or a way to get it. */
  function mrow (i) {
    var role = ROLE[i.key] || i.label
    return '<li' + (i.onDisk ? ' class="on"' : '') +
      '><span class="m-role" title="' + esc(i.label) + '">' + esc(role) + '</span>' +
      '<em>' + gb(i.bytes) + '</em>' +
      (i.onDisk
        ? '<b class="ok">ready</b>'
        : '<button class="link standalone dl-one" data-k="' + esc(i.key) + '" title="Download ' +
          esc(i.label) + ', ' + gb(i.bytes) + '">Get</button>') + '</li>'
  }

  function renderDetail () {
    var body = $('detail-body')
    var cat = st.catalogue
    var d = st.download
    var out = []

    if (d && d.running) {
      out.push('<div class="dl"><b>Downloading ' + esc(d.current || '') + '</b>' +
        '<div class="bar"><div class="bar-fill" style="width:' + (d.percent || 0) + '%"></div></div>' +
        '<span class="quiet">' + d.done + ' of ' + d.total + ', ' + (d.percent || 0) + '%</span></div>')
    } else if (d && d.error) {
      out.push('<div class="dl bad">' + esc(d.error) + '</div>')
    }

    out.push('<h4>Music model <span class="quiet">ACE-Step 1.5</span></h4>')
    if (!cat || !cat.available) {
      out.push('<p class="quiet">Catalogue unavailable.</p>')
    } else {
      out.push('<ul class="mlist">' + cat.items.filter(function (i) { return i.key !== 'writer' })
        .map(function (i) { return mrow(i) }).join('') + '</ul>')
    }

    var trunc = (st.models.acestep && st.models.acestep.truncated) || []
    if (trunc.length) {
      out.push('<div class="dl bad">Short files, ignored: ' + trunc.map(esc).join(', ') +
        '. An interrupted download leaves the final name on a partial file. Delete it from ~/.qvac/models and fetch it again.</div>')
    }

    out.push('<h4>Brief expander <span class="quiet">optional, Prompt mode</span></h4>')
    var w = cat && cat.items ? cat.items.find(function (i) { return i.key === 'writer' }) : null
    if (w) {
      out.push('<ul class="mlist">' + mrow(w) + '</ul>')
    }

    out.push('<h4>MiniMax-Music3 <span class="quiet">bring your own weights</span></h4>')
    out.push('<p class="quiet">Point the desk at your own <code>mm3-lm-*</code> and ' +
      '<code>mm3-synth-*</code>.</p>')
    out.push('<div class="row"><input type="text" id="mm3-dir" placeholder="~/mm3-demo/models/minimax" value="' +
      esc((st.models.minimax && st.models.minimax.dir) || '') + '"><button class="btn" id="mm3-scan">Scan</button></div>')

    if (st.caps) {
      out.push('<h4>Addon <span class="quiet">' + esc(st.caps.addonVersion) + '</span></h4>')
      var no = function (e) {
        return Object.keys(st.caps.accepts[e]).filter(function (k) { return !st.caps.accepts[e][k] }).length
      }
      out.push('<p class="quiet" title="Read from the addon at startup by asking its validator, ' +
        'not from a table in this app.">ACE-Step refuses ' + no('acestep') +
        ' options, MiniMax ' + no('minimax') + '.</p>')
    }
    var m = st.machine
    out.push('<h4>Machine</h4><p class="quiet">' + esc(m.platform) + ' ' + esc(m.arch) + ', ' +
      m.cpus + ' cores, ' + m.ramGB + ' GB</p>')

    body.innerHTML = out.join('')
    Array.prototype.forEach.call(body.querySelectorAll('.dl-one'), function (b) {
      b.onclick = function () {
        var row = b.closest('li')
        var role = row ? row.querySelector('.m-role').textContent : 'the model'
        downloadKeys([b.getAttribute('data-k')], role)
      }
    })
    if ($('mm3-scan')) {
      $('mm3-scan').onclick = function () {
        api('/api/models', { mm3Dir: $('mm3-dir').value }).then(function (j) {
          st.models = j.models
          fillStatics(); renderDetail(); renderBanner()
          toast(st.models.minimax.ready ? 'MiniMax found.' : 'Not found there: ' + st.models.minimax.missing.join(', '))
        }).catch(function (e) { toast(e.message) })
      }
    }
  }

  // ============================================================
  // Wiring
  // ============================================================

  function applyState (s) {
    st.caps = s.caps
    st.writer = s.writer
    st.vocab = s.vocab
    st.models = s.models
    st.machine = s.machine
    st.library = s.library || []
    st.takes = s.takes || []
    st.job = s.job
    st.pending = s.pending || 0
    st.download = s.download
    fillStatics()
    renderLibrary()
    renderTakes()
    syncSheet()          // paints the Length, Tempo and Takes readouts
    markPresets()
    renderTransport()
    renderDetail()
    renderBanner()
    loadCatalogue()
  }

  /**
   * Prompt or Manual. Both drive the same sheet, so switching is only ever a
   * change of surface: the brief box appears or goes, and the sheet is open by
   * default in Manual because filling it in IS Manual.
   */
  function setMode (m) {
    st.mode = m
    document.body.setAttribute('data-mode', m)
    Array.prototype.forEach.call(document.querySelectorAll('.mode'), function (b) {
      var on = b.getAttribute('data-m') === m
      b.classList.toggle('on', on)
      b.setAttribute('aria-selected', on ? 'true' : 'false')
    })
    setSheetOpen(m === 'manual' ? true : st.sheetOpen)
  }

  function setSheetOpen (open) {
    st.sheetOpen = open
    $('block-sheet').classList.toggle('open', open)
    $('sheet-toggle').setAttribute('aria-expanded', open ? 'true' : 'false')
  }

  Array.prototype.forEach.call(document.querySelectorAll('.mode'), function (b) {
    b.onclick = function () { setMode(b.getAttribute('data-m')) }
  })
  $('sheet-toggle').onclick = function () { setSheetOpen(!st.sheetOpen) }

  ;['caption', 'lyrics', 'bpm', 'keyscale', 'timesignature', 'duration'].forEach(function (id) {
    var node = $(id)
    var key = id === 'timesignature' ? 'timesignature' : id
    node.addEventListener('input', function () { markTouched(key); syncSheet(); if (id === 'caption') markPresets() })
    node.addEventListener('change', function () { markTouched(key); syncSheet(); if (id === 'caption') markPresets() })
  })
  $('vocal-language').addEventListener('change', function () { markTouched('vocalLanguage') })
  $('has-voices').addEventListener('change', function () { markTouched('instrumental'); syncSheet() })
  $('variations').addEventListener('input', syncSheet)
  $('reseed').onclick = function () { $('seed').value = Math.floor(Math.random() * 1e9) }

  $('do-expand').onclick = function () {
    var brief = $('brief').value.trim()
    if (!brief) return toast('Write what the music is for first.')
    var keep = {}
    var form = sheetFromForm()
    Object.keys(st.touched).forEach(function (k) {
      if (k === 'instrumental') keep.instrumental = form.instrumental
      else if (form[k] !== '' && form[k] !== 0) keep[k] = form[k]
    })
    expandBusy(true)
    api('/api/sheet', { brief: brief, keep: keep })
      .then(function (j) {
        sheetToForm(j.sheet)
        // Open the sheet so the expansion is visible, and say what changed in a
        // toast rather than parking prose on the screen. The model's own
        // reasoning about the brief is not shown at all: it is an essay, and the
        // sheet next to it is the answer.
        setSheetOpen(true)
        var notes = j.sheet.notes || []
        if (notes.length) toast(notes.join(' '))
      })
      .catch(function (e) { toast(e.message) })
      .then(function () { expandBusy(false) })
  }

  $('do-surprise').onclick = function () {
    var brief = $('brief').value.trim()
    if (!brief) return toast('Write a sentence first. Surprise me still needs to know what it is for.')
    render({
      task: 'surprise',
      brief: brief,
      sheet: { instrumental: !$('has-voices').checked },
      seed: Number($('seed').value) || undefined,
      variations: Number($('variations').value) || 3,
      formats: formatsFromForm(),
      advanced: advancedFromForm()
    })
    toast('The music model is writing the caption, the lyrics and the arrangement itself. It picks the length too.')
  }

  $('render').onclick = function () {
    var sheet = sheetFromForm()
    if (!sheet.caption) return toast('The sheet needs a style. Write a brief and press Write the sheet, or type one in.')
    render({
      task: 'compose',
      sheet: sheet,
      prefer: st.prefer,
      seed: Number($('seed').value) || undefined,
      variations: Number($('variations').value) || 3,
      formats: formatsFromForm(),
      advanced: advancedFromForm(),
      reference: st.reference
    })
  }

  $('cancel').onclick = function () { api('/api/cancel', {}).catch(function (e) { toast(e.message) }) }
  $('pick').onclick = function () { $('file').click() }
  $('file').onchange = function (e) { upload(e.target.files); e.target.value = '' }
  $('toast-x').onclick = function () { $('toast').hidden = true }
  $('open-detail').onclick = function () { $('detail').hidden = false }
  $('detail-x').onclick = function () { $('detail').hidden = true }
  $('detail').onclick = function (e) { if (e.target === $('detail')) $('detail').hidden = true }

  var drop = $('drop')
  ;['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over') })
  })
  ;['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over') })
  })
  drop.addEventListener('drop', function (e) { upload(e.dataTransfer.files) })

  // ---------- live events ----------
  function connect () {
    var es = new EventSource('/api/events')
    es.onmessage = function (m) {
      var d
      try { d = JSON.parse(m.data) } catch { return }
      if (d.t === 'job') { st.job = d.job; renderTransport() }
      else if (d.t === 'queue') { st.pending = d.pending; renderTransport(); renderTakes() }
      else if (d.t === 'take') { st.takes.unshift(d.take); renderTakes(); renderTransport() }
      else if (d.t === 'failed') { toast(d.error); renderTransport() }
      else if (d.t === 'library') { st.library.unshift(d.item); renderLibrary() }
      else if (d.t === 'ready') { st.caps = d.caps; st.writer = d.writer; fillStatics(); renderDetail() }
      else if (d.t === 'models') { st.models = d.models; fillStatics(); renderDetail(); renderBanner() }
      else if (d.t === 'download') {
        st.download = d.download
        renderDetail()
        if (!d.download.running && !d.download.error) { loadCatalogue(); toast('Models ready.') }
        if (d.download.error) toast('Download failed. ' + d.download.error)
      }
    }
    es.onerror = function () { setTimeout(connect, 2000) }
  }

  setMode('prompt')
  $('seed').value = Math.floor(Math.random() * 1e9)
  api('/api/state').then(function (s) { applyState(s); connect() }).catch(function (e) {
    toast('Could not reach the desk: ' + e.message)
  })
})()
