# pngjs 7.0.0, vendored

[pngjs](https://github.com/pngjs/pngjs) by Luke Page and contributors, MIT —
see `LICENSE`. `lib/` is the published package's `lib/` as it was, unchanged,
so that the tests read and write PNGs without a dependency.

Only the tests use it; nothing under `src/` does, and it is not in the
published package. `lib/png.d.ts` is added here: types for the part the tests
call.

To update it: copy `lib/` and `LICENSE` from the new release over these, and
change the version above.
