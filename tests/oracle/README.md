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

## ASTC: astcenc

[astcenc](https://github.com/ARM-software/astc-encoder), ARM's reference
encoder and decoder (Apache 2.0). Download a release for your platform —
check it against the release's `release-sha256.txt` — and point the scripts
at its binary:

```console
$ npx ts-node tests/oracle/compare-astc.ts path/to/astcenc 3000
$ npx ts-node tests/oracle/record-astc.ts path/to/astcenc
```

`compare-astc.ts` makes, for each of the fourteen 2D block sizes and each of
LDR, sRGB and HDR, random blocks, random blocks under a valid block mode,
void-extent blocks, and blocks astcenc encodes from generated test images;
has astcenc decode them (`-dl -decode_unorm8`, `-ds`, `-dH`), and compares
every texel. Last run, 3,000 of each kind: 90,065 valid blocks — every
colour endpoint mode 0–15, one to four partitions, 9,400 dual-plane — 169,853
not valid and 31,750 void extent, identical on every value.

`record-astc.ts` writes the fixtures in `tests/resources/astc/` and the
digests of astcenc's own decoding of them in `tests/golden/astc.json`, which
`tests/astc.test.ts` holds this package's decoding to.

Two things the comparison settled that the specification leaves open:

- astcenc writes HDR images to KTX with as few channels as the image seems
  to need, so HDR is compared through DDS, which it always writes as RGBA.
- astcenc decodes a negative channel of an HDR void-extent block as NaN;
  this package does too.

## UASTC and ETC1S: KTX-Software

[KTX-Software](https://github.com/KhronosGroup/KTX-Software)'s `ktx` tool
(Apache 2.0), from a release — check it against the release's `.sha1`. It
encodes with Basis Universal and transcodes with Basis Universal's own
decoder, so it is the reference for what a Basis file decodes to. `KTX` is
the command, which may run it in WSL from Windows:

```console
$ KTX=path/to/ktx npx ts-node tests/oracle/compare-uastc.ts
$ KTX="wsl -d Ubuntu-22.04 -- /path/to/ktx" npx ts-node tests/oracle/compare-uastc.ts
$ KTX=path/to/ktx npx ts-node tests/oracle/record-uastc.ts
$ KTX=path/to/ktx npx ts-node tests/oracle/compare-etc1s.ts
$ KTX=path/to/ktx npx ts-node tests/oracle/record-etc1s.ts
```

`compare-uastc.ts` encodes generated images — colour and alpha, opaque, grey
and alpha, smooth — linear and sRGB, at quality 0, 2 and 4 and with RDO,
then replaces the blocks with random ones of every mode; `ktx transcode
--target rgba8` decodes each; every texel is compared. Last run: identical on
all of them.

What the comparison settled: Basis's transcoder decodes UASTC without sRGB's
widening whatever the transfer function — so does this package, which moves
some sRGB values by one from what an ASTC decoder would give — and a file
whose data format descriptor has no alpha is decoded with alpha 255.

`compare-etc1s.ts` encodes generated images with `ktx create --encode
basis-lz` — colour and alpha, opaque, grey, grey and alpha, smooth — linear
and sRGB at quality 1, 128 and 255; with mipmaps from 61 × 37; an array of
three with mipmaps; a cube map; the most endpoints and selectors, and 16 of
each — and compares every value of every image with `ktx transcode --target
rgba8`'s, reading each image by range as an application would. Last run: 36
files, identical on all of them; so was KTX-Software's own
`cubemap_yokohama_blze.ktx2`, 72 images from an older encoder.

`ktx transcode` gives a grey file back in the channels it was made from —
grey in red, and alpha in green — where this package gives grey in red,
green and blue and alpha as alpha, as Basis's RGBA output does; the scripts
compare them so.
