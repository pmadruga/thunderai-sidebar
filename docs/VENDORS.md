# Vendored dependencies

The authoritative file inventory, source URLs, versions, licenses and SHA-256 checksums are in [`config/vendor-lock.json`](../config/vendor-lock.json). `python3 scripts/check_repository.py` verifies the checked-in bytes and package license coverage. Updates are reviewed manually, not downloaded and committed by an automated writer.

| Component | Version | License | Included notice |
|---|---|---|---|
| pages/_lib/list.js | 2.3.1 | MIT | [licenses/list.js-MIT.txt](../licenses/list.js-MIT.txt) |
| pages/_lib/tom-select.base.js | 2.6.2 | Apache-2.0 | [licenses/tom-select-Apache-2.0.txt](../licenses/tom-select-Apache-2.0.txt) |
| pages/_lib/tom-select.default.min.css | 2.6.2 | Apache-2.0 | [licenses/tom-select-Apache-2.0.txt](../licenses/tom-select-Apache-2.0.txt) |
| js/lib/diff.js | 9.0.0 | BSD-3-Clause | [licenses/jsdiff-BSD-3-Clause.txt](../licenses/jsdiff-BSD-3-Clause.txt) |
| api_webchat/markdown-it.min.js | 14.3.0 | MIT | [licenses/markdown-it-MIT.txt](../licenses/markdown-it-MIT.txt) |
| js/lib/pdfjs/pdf.min.mjs | 6.3.289 | Apache-2.0 | [js/lib/pdfjs/LICENSE](../js/lib/pdfjs/LICENSE) |
| js/lib/pdfjs/pdf.worker.min.mjs | 6.3.289 | Apache-2.0 | [js/lib/pdfjs/LICENSE](../js/lib/pdfjs/LICENSE) |

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream and derived-code attribution. Runtime libraries are bundled; a vendor update must update source bytes, checksum, version, source URL and licenses together. Do not overwrite a file from an arbitrary URL supplied by an issue or pull request. Fetch only the pinned release from the upstream project's source, inspect the diff, and run the test suite and Thunderbird smoke tests.
