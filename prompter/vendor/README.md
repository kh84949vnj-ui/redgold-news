# Third-party files

- `vosk.js`: vosk-browser 0.0.8 (https://github.com/ccoreilly/vosk-browser),
  Apache License 2.0. A WebAssembly build of the Vosk speech recognizer that
  runs entirely in the browser.
- `../models/vosk-model-small-en-us-0.15.tar.gz`: Vosk small US English model
  (https://alphacephei.com/vosk/models), Apache License 2.0, packaged for
  vosk-browser.

Both are stored here (not loaded from a CDN) so the prompter works offline and
no request leaves the device once the page is loaded.
