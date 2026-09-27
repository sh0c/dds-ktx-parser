# tiny-inflate 1.0.3, vendored

[tiny-inflate](https://github.com/foliojs/tiny-inflate) by Devon Govett, MIT —
see `LICENSE`; a port of Jørgen Ibsen's tinf. `index.js` is the release's
`index.js` as it was. `index.d.ts` is added here.

Used for KTX 2 levels supercompressed with zlib: the two-byte zlib header and
the Adler-32 after the data are handled in `src/decompress.ts`, and this
inflates what is between them.

To update it: copy the new release's `index.js` over this one and change the
version here.
