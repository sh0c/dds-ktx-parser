/*
 * Decode a file of ETC/EAC blocks with etcdec, the reference this package's
 * ETC decoder is compared against. Not built by the package: see README.md.
 *
 *   etc-oracle MODE BLOCKS OUT
 *
 * MODE is rgb, a1, rgba, r11 or rg11. OUT gets, a block at a time, 16 RGBA
 * pixels of 8 bits (rgb, a1, rgba) or 16 pixels of one or two 16-bit values
 * (r11, rg11), rows top to bottom.
 */
#define ETCDEC_IMPLEMENTATION
#include "etcdec.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 4) return 2;
    const char *mode = argv[1];
    int size = (!strcmp(mode, "rgba") || !strcmp(mode, "rg11")) ? 16 : 8;
    int pixel = !strcmp(mode, "r11") ? 2 : 4;
    FILE *in = fopen(argv[2], "rb"), *out = fopen(argv[3], "wb");
    if (!in || !out) return 1;
    unsigned char block[16], pixels[64];
    while (fread(block, 1, size, in) == (size_t)size) {
        memset(pixels, 0, sizeof pixels);
        if (!strcmp(mode, "rgb")) etcdec_etc_rgb(block, pixels, 16);
        else if (!strcmp(mode, "a1")) etcdec_etc_rgb_a1(block, pixels, 16);
        else if (!strcmp(mode, "rgba")) etcdec_eac_rgba(block, pixels, 16);
        else if (!strcmp(mode, "r11")) etcdec_eac_r11_u16(block, pixels, 8);
        else etcdec_eac_rg11_u16(block, pixels, 16);
        fwrite(pixels, 1, 16 * pixel, out);
    }
    fclose(in);
    fclose(out);
    return 0;
}
