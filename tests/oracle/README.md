# Comparing the decoders with reference decoders

The mobile formats are intricate, so each decoder here was compared,
pixel for pixel, with an independent decoder written by someone else. Those
decoders are not in this repository and not needed to run `npm test`: the
tests hold this package's output to digests recorded once the comparisons
passed. This folder is how to run the comparisons again, after a change to
a decoder.

## ETC and EAC: etcdec

[etcdec](https://github.com/iOrange/etcdec), a single C header (MIT or
Unlicense), built with any C compiler:

```console
$ curl -fLO https://raw.githubusercontent.com/iOrange/etcdec/main/etcdec.h
$ cc -O2 -o etc-oracle tests/oracle/etc-oracle.c    # with etcdec.h beside it
$ npx ts-node tests/oracle/compare-etc.ts ./etc-oracle 200000
```

Random blocks: any 64 bits are a valid ETC block, so they reach every mode —
individual, differential, T, H, planar, and punchthrough's transparency.
Last run: 200,000 blocks each of ETC2 RGB, RGB A1 and RGBA, and EAC R11 and
RG11, identical on every pixel.

Signed EAC is not compared: etcdec decodes it as unsigned and reinterprets
the bits, where the specification makes the base signed and drops the +4.
`tests/etc.test.ts` checks it against the specification's arithmetic
instead.
