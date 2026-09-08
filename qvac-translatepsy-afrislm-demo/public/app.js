/* ============================================================
   TranslatePsy-AfriSLM demo, browser side.

   Three screens: a two-step onboarding, then the app, with a models sheet you can
   reopen from the app bar.

   Step 1 exists because six model sizes is a question nobody should have to answer
   from a table. The SDK's assessModelFit reports what this machine can hold right
   now, and the app recommends one. Step 2 is optional on purpose: the reader model
   is only needed to photograph paper, so someone who will paste text never
   downloads it.

   The honesty rules from the first version are unchanged. A language pair the model
   was never trained on is labelled before you press Translate, and the picker keeps
   the fine-tuned, zero-shot and untrained groups apart.
   ============================================================ */
(function () {
  var $ = function (id) { return document.getElementById(id) }
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  var icon = function (n) { return '<svg class="icon"><use href="#i-' + n + '"/></svg>' }
  var gb = function (b) { return b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : Math.round(b / 1e6) + ' MB' }

  /**
   * Each tab keeps its own text, its own result AND its own language pair.
   *
   * Sharing them caused the worst bug this app has had. A translation done in the
   * Text tab stayed on screen in the Scan tab, and worse, the language pair came with
   * it: an English document scanned while the pair still read Swahili to English was
   * handed to the model as Swahili, and it answered in French, Spanish and Dutch. A
   * stale source language is not a cosmetic problem, it is a wrong answer.
   *
   * The Scan tab starts on Detect, because nobody knows what language a photographed
   * page is in before it has been read.
   */
  var tabs = {
    text: { input: '', out: '', meta: '', source: 'auto', target: 'en' },
    scan: { input: '', out: '', meta: '', source: 'auto', target: 'en' }
  }

  var st = {
    step: 0,
    tab: 'text',
    source: 'auto',
    target: 'en',
    langs: null,
    fit: null,
    sdk: null,
    translator: null,
    reader: null,
    readers: [],
    exampleLangs: [],
    exampleIndex: 0,
    scanned: false
  }

  function api (path, body, headers) {
    var init = body === undefined ? undefined : {
      method: 'POST',
      headers: headers || { 'Content-Type': 'application/json' },
      body: headers ? body : JSON.stringify(body)
    }
    return fetch(path, init).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status))
        return j
      })
    })
  }
  function toast (msg) { $('toast-text').textContent = msg; $('toast').hidden = false }
  $('toast-x').onclick = function () { $('toast').hidden = true }

  // ---------- language helpers ----------
  function allLangs () {
    if (!st.langs) return []
    return st.langs.fineTuned.concat(st.langs.heldOut, st.langs.other)
  }
  function nameOf (code) {
    if (code === 'auto') return 'Detect language'
    var hit = allLangs().filter(function (l) { return l.code === code })[0]
    return hit ? hit.name : code
  }
  function tierOf (code) {
    if (code === 'auto') return 'auto'
    if (st.langs.fineTuned.some(function (l) { return l.code === code })) return 'fine-tuned'
    if (st.langs.heldOut.some(function (l) { return l.code === code })) return 'zero-shot'
    return 'untrained'
  }

  // ============================================================
  // Onboarding
  // ============================================================

  function setStep (n) {
    st.step = n
    // The welcome screen is not one of the numbered steps, so it hides the dots.
    $('step0').hidden = n !== 0
    $('steps').hidden = n === 0
    $('dot1').className = 'step ' + (n > 1 ? 'done' : 'on')
    $('dot2').className = 'step ' + (n > 2 ? 'done' : n === 2 ? 'on' : '')
    $('dot3').className = 'step ' + (n === 3 ? 'on' : '')
    $('step1').hidden = n !== 1
    $('step2').hidden = n !== 2
    $('step3').hidden = n !== 3
  }

  /**
   * The download bar.
   *
   * Fed by the server's throttled progress events. Both onboarding steps have their
   * own block so the reader's two files report into step 2 while step 1 keeps the
   * translator's figures.
   */
  function renderDownload (e) {
    var box = $('dl-' + (st.step === 2 ? 2 : 1))
    if (!box) return
    box.hidden = false
    box.querySelector('.dl-label').textContent = e.label + (e.count > 1 ? '  (' + e.index + ' of ' + e.count + ')' : '')
    box.querySelector('.dl-pct').textContent = Math.round(e.percentage) + '%'
    box.querySelector('.dl-fill').style.width = Math.max(1, e.percentage) + '%'
    box.querySelector('.dl-meta').textContent = e.total
      ? gb(e.downloaded) + ' of ' + gb(e.total) + (e.done ? ', done' : '')
      : 'starting'
  }
  function hideDownload () {
    ;[$('dl-1'), $('dl-2')].forEach(function (b) { if (b) b.hidden = true })
  }

  /** Step 3: say what is on the machine, then hand over to the app. */
  function renderDone () {
    var rows = []
    if (st.translator) {
      var v = (st.fit && st.fit.variants.filter(function (x) { return x.id === st.translator.variantId })[0]) || null
      rows.push({ what: 'AfriSLM ' + st.translator.params + ' ' + st.translator.quant,
        note: (v ? gb(v.bytes) + ' on disk. ' : '') + 'Translates between English and 19 languages.' +
          (st.translator.loadedMs < 3000 ? ' It was already here.' : '') })
    }
    rows.push(st.reader
      ? { what: st.reader.label, note: 'Reads the words off a photographed page.' }
      : { what: 'No reader', note: 'Scanning is off. The Scan tab can fetch it whenever you want it.' })
    $('done-list').innerHTML = rows.map(function (r) {
      return '<div class="done-row">' + icon(st.reader || r.what.indexOf('No reader') === -1 ? 'ok' : 'question') +
        '<div class="what"><b>' + esc(r.what) + '</b><span>' + esc(r.note) + '</span></div></div>'
    }).join('')
    setStep(3)
  }
  $('start').onclick = function () { enterApp() }

  // The welcome CTA is the machine check: it moves to step 1 and starts measuring, so
  // pressing "Check your machine" does not then ask you to press "Check this machine".
  $('begin').onclick = function () {
    setStep(1)
    $('check').click()
  }

  $('check').onclick = function () {
    var b = this
    b.disabled = true
    b.textContent = 'measuring'
    api('/api/check', {})
      .then(function (fit) { st.fit = fit; renderCheck(); })
      .catch(function (e) { toast(e.message) })
      .finally(function () { b.disabled = false; b.textContent = 'Check again' })
  }

  /**
   * One size, everywhere it appears.
   *
   * This existed twice, once in the onboarding and once in the models sheet, and only
   * the onboarding copy learned about the cache: the sheet went on offering "Get" and
   * "will fit" for models already sitting on the disk. One renderer, one truth.
   */
  function variantRow (v, withMemory) {
    var loaded = st.translator && st.translator.variantId === v.id
    var meta = (v.cached ? gb(v.bytes) + ' on disk' : gb(v.bytes) + ' download') +
      (withMemory ? ', needs about ' + gb(v.needBytes) + ' in memory' : '') +
      ', BOUQuET ' + v.bouquet.toFixed(4)
    var chip = loaded
      ? '<span class="verdict fits">' + icon('ok') + 'in use</span>'
      : v.cached
        ? '<span class="verdict fits">' + icon('ok') + 'on this machine</span>'
        : verdictChip(v.verdict)
    return '<div class="vrow"><div class="vrow-main">' +
      '<div class="vrow-name">AfriSLM ' + esc(v.params + ' ' + v.quant) + '</div>' +
      '<div class="vrow-meta">' + meta + '</div></div>' + chip +
      (loaded ? '' : '<button class="btn" data-variant="' + v.id + '">' + (v.cached ? 'Use' : 'Get') + '</button>') +
      '</div>'
  }

  function verdictChip (v) {
    var map = {
      'likely-fits': ['fits', 'ok', 'will fit'],
      tight: ['tight', 'warn', 'tight'],
      'likely-too-large': ['no', 'no', 'too large'],
      unknown: ['unknown', 'question', 'cannot say']
    }
    var m = map[v] || map.unknown
    return '<span class="verdict ' + m[0] + '">' + icon(m[1]) + m[2] + '</span>'
  }

  function renderCheck () {
    var f = st.fit
    $('check-out').hidden = false

    // The machine, as the SDK measured it a second ago. Showing used and reserved
    // matters: the same laptop answers differently when it is busy, and that is the
    // honest answer rather than a fixed number from total RAM.
    var b = f.budget
    if (b) {
      var total = b.totalBytes
      var pct = function (x) { return Math.max(0, Math.min(100, (x / total) * 100)) }
      $('budget-card').innerHTML =
        '<div class="vrow-name">This machine, right now</div>' +
        '<div class="bar">' +
          '<i class="used" style="width:' + pct(b.usedBytes) + '%"></i>' +
          '<i class="reserved" style="width:' + pct(b.reservedBytes) + '%"></i>' +
          '<i class="free" style="width:' + pct(b.availableAfterReserveBytes) + '%"></i>' +
        '</div>' +
        '<div class="legend">' +
          '<span><i class="used"></i>' + gb(b.usedBytes) + ' in use</span>' +
          '<span><i class="reserved"></i>' + gb(b.reservedBytes) + ' held back</span>' +
          '<span><i class="free"></i>' + gb(b.availableAfterReserveBytes) + ' for a model</span>' +
        '</div>' +
        '<p class="fine" style="margin-top:8px">' + esc(f.machine.cpu) + ', ' + f.machine.cores +
          ' cores, ' + gb(total) + ' total. Measured by the SDK, not guessed from total memory.</p>'
    } else {
      $('budget-card').innerHTML = '<div class="vrow-name">This machine</div>' +
        '<p class="fine" style="margin-top:6px">' + esc(f.machine.cpu) + ', ' + f.machine.cores + ' cores, ' +
        gb(f.machine.totalBytes) + ' total. This SDK has no assessModelFit, so the budget below is an estimate.</p>'
    }

    var rec = f.recommended
    $('pick-card').innerHTML = rec
      ? '<div class="pick-head"><span class="pick-name">AfriSLM ' + esc(rec.params + ' ' + rec.quant) + '</span>' +
          (rec.cached ? '<span class="verdict fits">' + icon('ok') + 'on this machine</span>' : verdictChip(rec.verdict)) + '</div>' +
        '<p class="pick-why">' +
          (rec.cached
            ? 'Already downloaded, ' + gb(rec.bytes) + ' on disk, so there is nothing to fetch. '
            : gb(rec.bytes) + ' to download once, then it works offline. ') +
          'It scores ' + rec.bouquet.toFixed(4) + ' on BOUQuET, ' +
          (rec.cached ? 'the best of the sizes already here' : 'the best of the sizes that fit here') +
          '. Higher is better, and the whole family beats systems up to 152 times its size.</p>' +
        (rec.alternative
          ? '<p class="pick-why"><b>' + esc(rec.alternative.params + ' ' + rec.alternative.quant) +
            '</b> scores a little higher (' + rec.alternative.bouquet.toFixed(4) + ') and also fits, but it is ' +
            gb(rec.alternative.bytes) + ' to download. It is in the list below if you want it.</p>'
          : '')
      : '<div class="pick-head"><span class="pick-name">Nothing fits comfortably</span></div>' +
        '<p class="pick-why">Even the smallest size wants more memory than this machine has spare. ' +
          'Close some applications and check again, or try the 0.8B anyway from the list below.</p>'

    $('variant-rows').innerHTML = f.variants.map(function (v) { return variantRow(v, true) }).join('')
    $('fit-method').textContent = f.method + '.'

    $('download').textContent = !rec
      ? 'Download the smallest size'
      : (rec.cached ? 'Use AfriSLM ' : 'Download AfriSLM ') + rec.params + ' ' + rec.quant
    $('download-note').textContent = !rec ? ''
      : rec.cached
        ? 'Nothing to download. It loads from this machine in about a second.'
        : gb(rec.bytes) + ' over the network once. Nothing else leaves this machine, now or later.'
  }

  function download (variantId) {
    var note = $('download-note')
    $('download').disabled = true
    $('download').textContent = 'downloading'
    note.textContent = 'The first download takes a moment. It happens once.'
    api('/api/load', { variantId: variantId })
      .then(function (r) {
        st.translator = r.translator
        note.textContent = ''
        hideDownload()
        renderReaders()
        setStep(2)
      })
      .catch(function (e) { toast(e.message); note.textContent = '' })
      .finally(function () { $('download').disabled = false; renderCheck() })
  }

  $('download').onclick = function () {
    var rec = st.fit && st.fit.recommended
    download(rec ? rec.id : '0.8B-Q4')
  }
  $('variant-rows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-variant]')
    if (b) download(b.getAttribute('data-variant'))
  })

  function renderReaders () {
    $('reader-rows').innerHTML = st.readers.map(function (r) {
      var v = (st.fit && (st.fit.readers || []).filter(function (x) { return x.id === r.id })[0]) || {}
      return '<div class="rrow' + (r.recommended ? ' on' : '') + '">' +
        '<input type="radio" name="reader" value="' + r.id + '"' + (r.recommended ? ' checked' : '') + '>' +
        '<div class="vrow-main"><div class="vrow-name">' + esc(r.label) + '</div>' +
        '<div class="vrow-meta">' + gb(r.bytes) + (v.cached ? ' already on this machine. ' : ' with its projector. ') +
        esc(r.note) + '</div></div>' +
        (v.cached ? '<span class="verdict fits">' + icon('ok') + 'here</span>' : v.verdict ? verdictChip(v.verdict) : '') + '</div>'
    }).join('') || '<p class="fine">This SDK has no vision model in its registry, so scanning is not available.</p>'
    readerButtonLabel()
  }

  function readerButtonLabel () {
    var picked = document.querySelector('input[name="reader"]:checked')
    var v = picked && st.fit && (st.fit.readers || []).filter(function (x) { return x.id === picked.value })[0]
    $('get-reader').textContent = v && v.cached ? 'Use the reader' : 'Download reader'
  }
  $('reader-rows').addEventListener('change', readerButtonLabel)

  $('get-reader').onclick = function () {
    var picked = document.querySelector('input[name="reader"]:checked')
    if (!picked) return enterApp()
    var b = this
    b.disabled = true
    b.textContent = 'downloading'
    api('/api/reader', { readerId: picked.value })
      .then(function (r) { st.reader = r.reader; st.tab = 'scan'; hideDownload(); renderDone() })
      .catch(function (e) { toast(e.message) })
      .finally(function () { b.disabled = false; readerButtonLabel() })
  }
  $('skip').onclick = function () { st.tab = 'text'; renderDone() }

  // ============================================================
  // The app
  // ============================================================

  function enterApp () {
    $('onboard').hidden = true
    $('app').hidden = false
    $('tabbar').hidden = false
    setTab(st.tab)
    renderChip()
    renderLangBar()
    count()
  }

  function saveTab () {
    var t = tabs[st.tab]
    if (!t) return
    t.input = $('input').value
    t.out = $('output').getAttribute('data-plain') || ''
    t.meta = $('out-meta').textContent
    t.source = st.source
    t.target = st.target
  }

  function restoreTab () {
    var t = tabs[st.tab]
    if (!t) return
    $('input').value = t.input
    st.source = t.source
    st.target = t.target
    $('out-meta').textContent = t.meta
    if (t.out) renderOut([{ translated: t.out }])
    else renderOut([])
    renderLangBar()
    count()
  }

  function setTab (tab) {
    // The scan tab needs the reader. Rather than hiding the tab, it offers to get it.
    if (tab !== st.tab) saveTab()
    var switching = tab !== st.tab
    st.tab = tab
    document.querySelectorAll('.tab').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab))
    })
    var scanning = tab === 'scan'
    $('scan-cta').hidden = !scanning || st.scanned
    $('preview').hidden = !scanning || !st.scanned
    $('input').hidden = scanning && !st.scanned
    $('input').placeholder = scanning ? 'The words read from the page appear here' : 'Enter text'
    $('example').hidden = scanning
    $('clear').hidden = !st.scanned
    if (switching) restoreTab()
    if (scanning && !st.reader) {
      $('scan-cta').innerHTML =
        '<svg class="icon big"><use href="#i-camera"/></svg>' +
        '<p class="cta-title">Scanning needs one more model</p>' +
        '<p class="fine">AfriSLM reads text, not images. A small reader model, about half a gigabyte, ' +
        'reads the words off the page first.</p>' +
        '<button class="btn primary" id="enable-scan">Get the reader</button>'
      $('enable-scan').onclick = function () {
        var pick = (st.readers.filter(function (r) { return r.recommended })[0] || st.readers[0])
        if (!pick) return toast('This SDK has no vision model available.')
        this.disabled = true
        this.textContent = 'downloading'
        api('/api/reader', { readerId: pick.id })
          .then(function (r) { st.reader = r.reader; st.scanned = false; setTab('scan'); renderChip() })
          .catch(function (e) { toast(e.message); })
      }
    }
  }
  document.querySelectorAll('.tab').forEach(function (b) {
    b.onclick = function () { setTab(b.getAttribute('data-tab')) }
  })

  function renderChip () {
    var t = st.translator
    $('model-chip-text').textContent = t ? 'AfriSLM ' + t.params : 'models'
    $('model-chip').className = 'model-chip' + (t ? ' on' : '')
  }

  function renderLangBar () {
    $('source-label').textContent = nameOf(st.source)
    $('target-label').textContent = nameOf(st.target)
    var notes = []
    ;[st.source, st.target].forEach(function (c) {
      var t = tierOf(c)
      if (t === 'zero-shot') notes.push(nameOf(c) + ' was never in the fine-tuning data. The model transfers to it, which is a research result rather than a support claim.')
      if (t === 'untrained') notes.push(nameOf(c) + ' is not a training pair for this model: every pair was English to an African language. Treat the result as unverified.')
    })
    // No banner for an African to African pair. It is zero-shot in the training sense,
    // and it is also the model's best published result: the 2B leads every measured
    // system across 20 such directions. Putting that in a warning box told people to
    // distrust the one thing this model is best at. Warnings are kept for the cases
    // where the input really is unsupported.
    $('tier').hidden = !notes.length
    $('tier').textContent = notes.join('  ')
  }

  // ---------- the language sheet ----------
  var picking = null
  function openLangSheet (which) {
    picking = which
    $('lang-sheet-title').textContent = which === 'source' ? 'Translate from' : 'Translate into'
    var current = which === 'source' ? st.source : st.target
    var group = function (label, list, badge) {
      return '<div class="lang-group">' + esc(label) + '</div>' + list.map(function (l) {
        return '<button class="lang-item' + (l.code === current ? ' on' : '') + '" data-code="' + l.code + '">' +
          esc(l.name) + (badge ? '<span class="badge">' + esc(badge) + '</span>' : '') + '</button>'
      }).join('')
    }
    $('lang-list').innerHTML =
      (which === 'source' ? '<button class="lang-item' + (current === 'auto' ? ' on' : '') + '" data-code="auto">Detect language</button>' : '') +
      group('Fine-tuned', st.langs.fineTuned) +
      group('Zero-shot, never fine-tuned', st.langs.heldOut, 'transfer') +
      group('Not a training pair', st.langs.other, 'unverified')
    $('lang-sheet').hidden = false
  }
  $('source-btn').onclick = function () { openLangSheet('source') }
  $('target-btn').onclick = function () { openLangSheet('target') }
  $('lang-close').onclick = function () { $('lang-sheet').hidden = true }
  $('lang-sheet').addEventListener('click', function (e) {
    if (e.target === this) this.hidden = true
    var b = e.target.closest('[data-code]')
    if (!b) return
    var code = b.getAttribute('data-code')
    if (picking === 'source') st.source = code
    else st.target = code
    if (st.source !== 'auto' && st.source === st.target) {
      // Same language both sides is a no-op the model would happily perform.
      st.target = st.source === 'en' ? 'sw' : 'en'
    }
    $('lang-sheet').hidden = true
    renderLangBar()
    st.exampleIndex = 0
  })

  $('swap').onclick = function () {
    if (st.source === 'auto') return toast('Choose a source language first, otherwise there is nothing to swap.')
    var s = st.source
    st.source = st.target
    st.target = s
    var out = $('output').getAttribute('data-plain') || ''
    if (out) { $('input').value = out; renderOut([]) }
    renderLangBar()
    count()
  }

  // ---------- examples ----------
  $('example').onclick = function () {
    var code = st.source === 'auto' ? 'sw' : st.source
    if (st.exampleLangs.indexOf(code) === -1) {
      return toast('No example sentence for ' + nameOf(code) + ' in this build. There are ' +
        st.exampleLangs.length + ' languages with examples.')
    }
    fetch('/api/examples?lang=' + code).then(function (r) { return r.json() }).then(function (d) {
      if (!d.samples.length) return toast('No example for ' + nameOf(code) + '.')
      var s = d.samples[st.exampleIndex % d.samples.length]
      st.exampleIndex++
      st.source = code
      if (st.target === code) st.target = 'en'
      $('input').value = s.text
      renderLangBar()
      count()
      // Say where the sentence came from. Every example is the model's own output from
      // a fixed English sentence, so it exercises the app and proves nothing about it.
      // The fixture used to carry sentences from the released dataset as well, which is
      // CC-BY-NC 4.0 and could not ship in an Apache 2.0 repository.
      $('status').textContent = 'Example generated by this model from: ' + s.english
    })
  }

  // ---------- scanning ----------
  $('pick').onclick = function () { $('file').click() }
  $('file').onchange = function () { if (this.files[0]) scan(this.files[0]) }

  /**
   * Drag and drop, and it is not a convenience.
   *
   * The native file picker shows the account name and the contents of the folder, so
   * it is the one surface of this app that cannot appear in a screen recording.
   * Dropping a file from the desktop shows nothing but the file. The listeners live
   * on the card rather than on the prompt inside it, because that prompt is rebuilt
   * whenever the reader is missing and would take its listeners with it.
   */
  var card = $('input-card')
  var depth = 0   // a counter, not a flag: dragleave usually fires on a child
  card.addEventListener('dragenter', function (e) {
    e.preventDefault()
    depth++
    card.classList.add('dropping')
  })
  card.addEventListener('dragover', function (e) { e.preventDefault() })
  card.addEventListener('dragleave', function (e) {
    e.preventDefault()
    depth = Math.max(0, depth - 1)
    if (!depth) card.classList.remove('dropping')
  })
  card.addEventListener('drop', function (e) {
    e.preventDefault()
    depth = 0
    card.classList.remove('dropping')
    var file = (e.dataTransfer.files || [])[0]
    if (!file) return
    if (!/^image\//.test(file.type)) return toast('That is not an image. Drop a photo or a scan of a page.')
    if (!st.reader) return toast('Scanning needs the reader model. The Scan tab can fetch it.')
    if (st.tab !== 'scan') setTab('scan')
    scan(file)
  })

  function scan (file) {
    $('status').textContent = 'reading the page on this machine'
    var reader = new FileReader()
    reader.onload = function () { $('preview').src = reader.result }
    reader.readAsDataURL(file)
    api('/api/scan', file, { 'Content-Type': 'application/octet-stream', 'x-filename': file.name })
      .then(function (r) {
        st.scanned = true
        $('input').value = r.text
        setTab('scan')
        count()
        // Read the language off the page rather than trusting whatever the picker was
        // left on. This is the fix for a scanned English notice being translated as
        // though it were Swahili, which produced French and Dutch.
        return api('/api/detect', { text: r.text }).then(function (d) {
          if (d.code) {
            st.source = d.code
            if (st.target === d.code) st.target = d.code === 'en' ? 'sw' : 'en'
            renderLangBar()
            $('status').textContent = 'Read on this machine, in ' + d.name +
              '. Check the text, then translate.'
            // Measured: the VisionPsy readers get 78 and 68 percent of the words on a
            // Swahili page, and those errors become a wrong day and a wrong dose once
            // translated. The OCR readers get 100 percent. So warn only when a
            // VisionPsy reader has just read a page that is not in English.
            if (d.code !== 'en' && st.reader && /VisionPsy/i.test(st.reader.label)) {
              toast('This reader misreads African-language text: it got 78 percent of the words on a ' +
                'test page in Swahili, and that became a wrong weekday and a wrong dose once translated. ' +
                'Check names, dates and numbers, or switch to QVAC OCR from the models panel.')
            }
          } else {
            st.source = 'auto'
            renderLangBar()
            $('status').textContent = 'Read on this machine. Pick the language it is written in, then translate.'
          }
        })
      })
      .catch(function (e) { $('status').textContent = ''; toast(e.message) })
  }

  $('clear').onclick = function () {
    st.scanned = false
    $('input').value = ''
    renderOut([])
    setTab(st.tab)
    count()
  }

  // ---------- translating ----------
  function count () {
    var n = $('input').value.length
    $('count').textContent = n ? n + ' characters' : ''
    $('go').disabled = !n || !st.translator
  }
  $('input').addEventListener('input', count)

  function renderOut (chunks, pending) {
    var box = $('output')
    if (!chunks.length && !pending) {
      box.innerHTML = '<span class="ph">Translation</span>'
      box.setAttribute('data-plain', '')
      return
    }
    var plain = chunks.map(function (c) { return c.translated }).join('\n\n')
    box.setAttribute('data-plain', plain)
    box.innerHTML = esc(plain) + (pending ? '<span class="pending">' + (plain ? '\n\n' : '') + esc(pending) + '</span>' : '')
  }

  $('go').onclick = function () {
    var text = $('input').value.trim()
    if (!text) return
    $('go').disabled = true
    $('status').textContent = ''
    renderOut([], 'working on this machine')
    var t0 = Date.now()
    api('/api/translate', { text: text, source: st.source, target: st.target })
      .then(function (r) {
        renderOut(r.chunks)
        $('out-meta').textContent = r.chunks.length + ' paragraph' + (r.chunks.length === 1 ? '' : 's') +
          ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s' +
          (r.detected && r.detected.name ? ', detected ' + r.detected.name : '')
        if (r.detected && !r.detected.name) {
          toast('The source language could not be identified with confidence, so English was assumed. Pick it by hand for a better result.')
        }
      })
      .catch(function (e) { toast(e.message); renderOut([]) })
      .finally(count)
  }

  $('copy').onclick = function () {
    var plain = $('output').getAttribute('data-plain') || ''
    if (!plain) return
    navigator.clipboard.writeText(plain).then(function () { $('status').textContent = 'copied' })
  }

  // ---------- the models sheet ----------
  $('model-chip').onclick = function () {
    // No measurement yet means no verdicts and no cache state, so take one first
    // rather than opening a sheet with a hole in it.
    if (!st.fit) {
      $('model-chip-text').textContent = 'checking'
      return api('/api/check', {})
        .then(function (f) { st.fit = f; renderChip(); openModelsSheet() })
        .catch(function (e) { renderChip(); toast(e.message) })
    }
    openModelsSheet()
  }

  function openModelsSheet () {
    var f = st.fit
    var body = '<div class="models-block"><h3>Translator</h3>' +
      (st.translator
        ? '<div class="vrow"><div class="vrow-main"><div class="vrow-name">AfriSLM ' +
          esc(st.translator.params + ' ' + st.translator.quant) + '</div>' +
          '<div class="vrow-meta">loaded in ' + (st.translator.loadedMs / 1000).toFixed(1) + ' s</div></div>' +
          '<span class="verdict fits">' + icon('ok') + 'in use</span></div>'
        : '<p class="fine">None loaded yet. Setup picks one for this machine.</p>') +
      '</div>'
    // Three states, not two. "Not downloaded" was printed for a reader sitting on the
    // disk, because this only ever asked whether one was loaded in this session.
    var onDiskReaders = (st.fit ? (st.fit.readers || []) : []).filter(function (r) { return r.cached })
    body += '<div class="models-block"><h3>Reader, for scanning paper</h3>' +
      (st.reader
        ? '<div class="vrow"><div class="vrow-main"><div class="vrow-name">' + esc(st.reader.label) + '</div>' +
          '<div class="vrow-meta">loaded in ' + (st.reader.loadedMs / 1000).toFixed(1) + ' s</div></div>' +
          '<span class="verdict fits">' + icon('ok') + 'in use</span></div>'
        : onDiskReaders.length
          ? onDiskReaders.map(function (r) {
              return '<div class="vrow"><div class="vrow-main"><div class="vrow-name">' + esc(r.label) + '</div>' +
                '<div class="vrow-meta">' + gb(r.bytes) + ' on disk, not loaded</div></div>' +
                '<span class="verdict fits">' + icon('ok') + 'on this machine</span>' +
                '<button class="btn" data-reader="' + r.id + '">Use</button></div>'
            }).join('')
          : '<p class="fine">Not downloaded. The Scan tab offers it when you need it.</p>') +
      '</div>'
    if (f) {
      body += '<div class="models-block"><h3>All six sizes</h3>' +
        f.variants.map(function (v) { return variantRow(v, false) }).join('') +
        '<p class="fine">' + esc(f.method) + '.</p></div>'
    }
    body += '<div class="models-block"><h3>Setup</h3>' +
      '<p class="fine">The setup steps run once, when no model is loaded yet. ' +
      'You can walk through them again at any time: nothing is deleted and a model already ' +
      'on disk loads straight back.</p>' +
      '<button class="btn big" id="rerun" style="margin-top:10px">Run setup again</button></div>'
    body += '<div class="models-block"><h3>Versions</h3><p class="fine">SDK ' +
      esc(st.sdk ? st.sdk.sdkVersion : '?') + ' through the qvac CLI ' + esc(st.sdk ? st.sdk.cliVersion : '?') +
      '. TranslatePsy-AfriSLM is Apache 2.0, released for research and educational use.</p></div>'
    $('models-body').innerHTML = body
    $('models-sheet').hidden = false
  }
  $('models-close').onclick = function () { $('models-sheet').hidden = true }

  /**
   * Back to step 1, with the measurement cleared so the check runs fresh.
   *
   * The loaded model is deliberately left alone: this is for seeing the flow again,
   * or for moving to a different size, not for throwing away a download.
   */
  function rerunSetup () {
    $('models-sheet').hidden = true
    $('app').hidden = true
    $('tabbar').hidden = true
    $('onboard').hidden = false
    $('check-out').hidden = true
    $('check').textContent = 'Check this machine'
    hideDownload()
    // A re-run skips the welcome: you have already been welcomed.
    // Only offered on a re-run: on a real first run there is nothing to go back to.
    $('leave-setup').hidden = !st.translator
    setStep(1)
  }
  $('leave-setup').onclick = function () { enterApp() }
  $('models-sheet').addEventListener('click', function (e) {
    if (e.target === this) { this.hidden = true; return }
    if (e.target.closest('#rerun')) return rerunSetup()
    var rb = e.target.closest('[data-reader]')
    if (rb) {
      // On disk already, so this is a load and not a download.
      rb.disabled = true
      rb.textContent = 'loading'
      var sheet = this
      return api('/api/reader', { readerId: rb.getAttribute('data-reader') })
        .then(function (r) { st.reader = r.reader; sheet.hidden = true; setTab(st.tab); renderChip() })
        .catch(function (err) { toast(err.message); rb.disabled = false; rb.textContent = 'Use' })
    }
    var b = e.target.closest('[data-variant]')
    if (!b) return
    this.hidden = true
    $('onboard').hidden = false
    $('app').hidden = true
    setStep(1)
    renderCheck()
    download(b.getAttribute('data-variant'))
  })

  // ---------- live events ----------
  function connect () {
    var es = new EventSource('/api/events')
    es.onmessage = function (m) {
      var e = JSON.parse(m.data)
      if (e.t === 'download') { if (!$('onboard').hidden) renderDownload(e); else $('status').textContent = e.label + ' ' + Math.round(e.percentage) + '%' }
      else if (e.t === 'cached') {
        // No bar for a file that is already here, just the fact.
        if (!$('onboard').hidden) {
          var box = $('dl-' + (st.step === 2 ? 2 : 1))
          box.hidden = false
          box.querySelector('.dl-label').textContent = e.label
          box.querySelector('.dl-pct').textContent = ''
          box.querySelector('.dl-fill').style.width = '100%'
          box.querySelector('.dl-meta').textContent = 'already on this machine, loading'
        } else { $('status').textContent = e.label + ' is already on this machine' }
      }
      else if (e.t === 'busy' && e.label) $('status').textContent = e.label
      else if (e.t === 'partial') {
        var box = $('output')
        var plain = box.getAttribute('data-plain') || ''
        plain = plain ? plain + '\n\n' + e.translated : e.translated
        box.setAttribute('data-plain', plain)
        box.innerHTML = esc(plain) + (e.index + 1 < e.total
          ? '<span class="pending">\n\nparagraph ' + (e.index + 2) + ' of ' + e.total + '</span>' : '')
      }
    }
  }

  // ---------- boot ----------
  fetch('/api/state').then(function (r) { return r.json() }).then(function (s) {
    st.langs = s.languages
    st.sdk = s.sdk
    st.fit = s.fit
    st.translator = s.translator
    st.reader = s.reader
    st.readers = s.readersAvailable || []
    st.exampleLangs = s.exampleLanguages || []
    connect()
    if (st.translator) { enterApp() } else { setStep(0); renderReaders() }
    renderChip()
  }).catch(function (e) { toast('Could not reach the server: ' + e.message) })
})()
