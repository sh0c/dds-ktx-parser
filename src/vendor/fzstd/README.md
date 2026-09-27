# fzstd 0.1.1, vendored

[fzstd](https://github.com/101arrowz/fzstd) by Arjun Barrett, MIT — see
`LICENSE`. `index.ts` is the release's `src/index.ts` as it was, with four
lines added at the top: `// @ts-nocheck` and a note, so that this project's
stricter compiler settings do not check code it does not own.

Used for KTX 2 levels supercompressed with Zstandard. Only `decompress` is
called.

To update it: copy the new release's `src/index.ts` over `index.ts`, keep the
four lines at the top, and change the version here.
