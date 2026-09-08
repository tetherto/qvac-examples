# TranslatePsy-AfriSLM Demo

A demo of [TranslatePsy-AfriSLM](https://huggingface.co/collections/qvac/translatepsy-afrislm),
QVAC's translation model for 19 Sub-Saharan African languages. Paste some text or photograph a
page, and read it in your language. Every model runs on the machine in front of you: no account,
no API key, and no network at all once the models are on disk. The smallest size is a 0.67 GB
download.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/badges/built-with-qvac-dark-mode-landscape-transparent.svg">
  <img alt="Built with QVAC" src="docs/badges/built-with-qvac-light-mode-landscape-transparent.svg" width="200">
</picture>

> **This is an example, not a product.** It is a self-contained prototype showing what the QVAC
> SDK can do with TranslatePsy-AfriSLM. It is **not a QVAC or Tether product**, it is **not a
> translation service**, and it ships **as-is with no support, no warranty, and no SLA**. The
> model card puts **medical, legal, emergency, immigration and financial use out of scope**, and a
> local model gets things wrong in ways a reader who does not speak the language cannot spot. Do
> not rely on it for anything that has a consequence: get a human translator. **You alone are
> responsible for how you use it.** See [About this example](#about-this-example).

## What you get

- **Text.** Paste or type, pick a direction, translate. On the 0.8B at Q4 a sentence comes back in
  0.1 to 0.2 seconds.
- **Scan.** Drop in a photograph of a page. The words are read off it on-device, shown to you so
  you can correct them, and translated block by block.
- **One African language straight into another.** Swahili into Oromo, with no English in the
  middle. Every training pair in this model was English to an African language, and the published
  result is that the 2B is the best measured system across 20 such directions.
- **The source language is worked out in code**, not asked of a model. Script ranges settle
  Ethiopic and Arabic, then weighted function words and accent marks, with an explicit "not sure"
  when nothing wins by a margin.
- **Try an example** loads a sentence in whichever language you have selected, for all 19.
- **Onboarding measures the machine** and downloads the size that suits it.

## How it works

Two models, in a row. **TranslatePsy-AfriSLM does not read images**: it is a text-in, text-out
translation model, so the scan tab is a pipeline and not one call.

```
photo -> QVAC OCR (reads the words) -> text you can edit -> AfriSLM (translates) -> your language
```

| Job | Model | Where it comes from |
|-----|-------|---------------------|
| Translation, 19 languages | **TranslatePsy-AfriSLM** 0.8B / 2B / 4B, Q4_K_M or Q8_0 | Hugging Face GGUF, `huggingface.co/qvac` |
| Reading a photographed page | **QVAC OCR 0.6B** (or 3B, or VisionPsy-Nano) | the QVAC model registry |
| Language identification | none, it is 60 lines in `lib/detect.js` | |

### Choosing a model size at run time

Six sizes is too many to put to a person as a table, so the app asks the SDK.
[`assessModelFit`](https://docs.qvac.tether.io) (SDK 0.19) reports the machine's memory budget as
it stands right now, and the app recommends one size and offers to fetch it.

The budget it reports is what the machine can spare at that moment, including what other
applications are holding, so the answer on a busy machine differs from the answer on an idle one.
That is the point of asking at run time instead of dividing total RAM by a rule of thumb.

`assessModelFit` **cannot rate the six translator sizes**, and says so plainly: "no resource
profile in the catalog for this checksum", verdict `unknown`. It looks up a profile by checksum
and these are Hugging Face GGUFs rather than registry models. So the app takes the SDK's budget,
which is real and live, and computes the estimate for the GGUFs itself. The screen says which
number came from where. The readers are registry models, so their verdicts come straight from the
SDK, with the projector passed as an `artifacts` entry so its 109 MB is counted.

The recommendation prefers what is already on the disk. If the best-scoring size that fits is not
downloaded and a slightly smaller one is, the app recommends the one already there and names the
better option with its download size underneath.

| Variant | Download | BOUQuET SSA-COMET |
|---|---|---|
| 0.8B Q4_K_M | 0.67 GB | 0.6157 |
| 0.8B Q8_0 | 1.08 GB | 0.6207 |
| 2B Q4_K_M | 1.56 GB | 0.6299 |
| 2B Q8_0 | 2.55 GB | 0.6310 |
| 4B Q4_K_M | 3.07 GB | 0.6377 |
| 4B Q8_0 | 5.16 GB | 0.6384 |

The strongest option is the best score among those that fit, which is not the largest file: the
4B at Q4 outscores the 2B at Q8 and is 1.5 GB smaller.

### The scan feature: combining AfriSLM with a vision model

The four readers do not read every language equally well, and a page in an African language is a
harder test than a page in English. Two word errors on a date or a dosage change the meaning of
the translation that follows, so choose the reader on a page in the language you care about rather
than on an English one. This demo defaults to **QVAC OCR 0.6B**, which read both of the sample
pages here correctly. If a smaller reader is selected instead, the app warns after it reads a page
that is not in English.

Pairing a translation model with a vision model this way is something put together for this demo.
It has not been extensively tested by the QVAC research team, so treat the scan path as a
demonstration of what the two models can do together.

### The prompt is verbatim, on purpose

The system and user messages in `lib/translate.js` are copied from the model card, trailing space
and `\n\nTranslation:` included, with language names written out in full ("Swahili", not "sw").
A translation model is far more sensitive to its template than a chat model: reword it and
quality drops with no error to explain why. Decoding is greedy, `reasoning_budget: 0` because the
base model is Qwen3.5 and will otherwise emit a think block mid-translation, context 2048 to
match the context the published GGUF scores were measured at, and `kvCache: false` per paragraph
so the model translates this paragraph instead of continuing the last one.

## Recommended hardware

Everything runs on your machine. The translator downloads once from Hugging Face and the reader
once from the QVAC registry, both into the shared `~/.qvac/models/` cache. After that it works
with the network off.

| Size | Download | Phones that hold it | Laptops that hold it |
|---|---|---|---|
| 0.8B | 0.67 GB | an 8 GB phone: iPhone 16, or a mid-range Android | any 8 GB laptop, a MacBook Air M1 |
| 2B | 1.56 GB | a 12 GB phone: Galaxy S25, iPhone 16 Pro Max | a 16 GB laptop, a MacBook Air M2 or M3 |
| 4B | 3.07 GB | flagship only, 16 GB | 16 GB and up, a MacBook Pro or a discrete GPU |

Add 1.22 GB for the OCR reader if you want to scan paper. Both columns are guidance from the
download size against the memory those devices have, rather than a benchmark run on each one.

The phone column is the reason these sizes exist: TranslatePsy-AfriSLM is published as GGUF for
on-device deployment, and the release notes it as running on an ordinary phone with no GPU and no
connection. This example is a local web app, so what it runs on today is a laptop or a desktop:
macOS 14+, Windows 10+ or Linux, with Node.js 22.17 or newer and the `qvac` CLI on PATH. Apple
Silicon uses Metal, a Vulkan GPU works too, and CPU is slower but fine at the smaller sizes.
Putting the same model into a mobile app is a separate build.

The app measures your machine and picks a size, so the table is background. Not sure it will run
at all? Run `npx -y @qvac/cli doctor`.

Models this example runs:

- **TranslatePsy-AfriSLM**, 0.8B / 2B / 4B at Q4_K_M or Q8_0, 0.67 GB to 5.16 GB. Downloaded from
  Hugging Face on first use. Does every translation.
- **QVAC OCR 0.6B**, 1.22 GB with its vision projector. Downloaded from the QVAC registry, and
  only if you want to scan paper. Reads the words off a photographed page.

## Run it

There are no dependencies to install. The SDK is resolved from the `qvac` CLI on your PATH, so
the version shown in the app header is the version doing the work.

```bash
npm i -g @qvac/cli     # if you do not have it
npm start
```

Open **http://localhost:3065**. Onboarding measures the machine, recommends a size, downloads it
with a real progress bar, and asks whether you also want the reader for scanning paper. Then
paste something, or drop `fixtures/clinic-letter-sw.png` onto the Scan tab.

The first model load pulls the GGUF from Hugging Face, 46.6 seconds measured for the 0.8B at Q4,
and every load after that is about 8 seconds from cache.

To see the onboarding again: the model chip in the top right, then **Run setup again**. Nothing
is deleted, and a model already on disk loads back in about a second. Restarting the server puts
the app back into the state a new user sees, because what is loaded lives in memory only.

## Sample documents and example sentences

`fixtures/clinic-letter.png` and `fixtures/clinic-letter-sw.png` are the same invented notice in
English and Swahili, and both say **SAMPLE DOCUMENT, not a real record** on their face. Nothing
in them refers to a real clinic, person, or appointment.

`fixtures/test-sentences.json` carries two sentences for each of the 19 languages, loaded by the
"Try an example" button. **Every one is the model's own output**, produced by the 2B at Q4 from
one of two fixed English sentences, with the round trip back to English stored alongside. They
exercise the app and are not reference translations. Regenerate them with:

```bash
npm run examples          # all 19
node bin/make-examples.mjs zu     # one language
```

## About this example

This app lives in [`qvac-examples`](https://github.com/tetherto/qvac-examples), Tether's
open-source collection of focused prototypes that show what the QVAC SDK can do with local AI.
It is:

- **An example, not a product.** Small, readable, and meant to be run from clean.
- **Not a translation service.** The model card puts medical, legal, emergency, immigration and
  financial use out of scope, which covers most of the paperwork somebody would want to point
  this at. Treat a translation from it as a rough sense of what a page says.
- **Unsupported.** Provided as-is, with no support, warranty, or guarantees.
- **Your responsibility to use lawfully**, including anything you scan that belongs to somebody
  else.
- **A starting point.** Fork it, read it, adapt it.

## Languages

**19 fine-tuned:** Afrikaans, Amharic, Hausa, Igbo, Kinyarwanda, Lingala, Luganda, Malagasy,
Nyanja, Oromo, Shona, Somali, Southern Sotho, Swahili, Tswana, Wolof, Xhosa, Yoruba, Zulu. Plus
English, which every training pair went through.

**8 held-out**, never seen in fine-tuning and offered separately in the picker: Akan, Bambara,
Kituba, Moore, Nigerian Pidgin, Sepedi, Sudanese Arabic, Tamazight. The paper reports the model
improves on its own backbone for every one of them, which is a transfer result rather than a
support claim.

Do not describe the model as covering 27 languages: 19 were fine-tuned and 8 are a transfer
result.

## License

Code licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).

This example downloads and runs models that carry their own terms:

- **TranslatePsy-AfriSLM** weights are Apache 2.0, released for research and educational
  purposes. Its **synthetic training data is CC-BY-NC 4.0**, a different licence, and the two
  should never be quoted as one. The paper is a forthcoming EMNLP 2026 submission, live now as a
  preprint at [arxiv.org/abs/2608.18655](https://arxiv.org/abs/2608.18655).
- **QVAC OCR** and **VisionPsy-Nano** come from the QVAC model registry, under their own model
  cards.

Using this example is subject to each of those licences as well as this one.

## About QVAC

QVAC is an open-source, cross-platform ecosystem for building local-first, peer-to-peer AI
applications. With QVAC you can run AI tasks like LLMs, vision, speech, and RAG locally across
Linux, macOS, Windows, Android, and iOS. Learn more at
[qvac.tether.io](https://qvac.tether.io), read the docs at
[docs.qvac.tether.io](https://docs.qvac.tether.io).
