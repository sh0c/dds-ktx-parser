// Inflate raw DEFLATE data from @source into @dest, which must be exactly as
// long as the inflated data. Answers @dest, or a shorter view of it.
declare function tinf_uncompress(source: Uint8Array, dest: Uint8Array): Uint8Array
export = tinf_uncompress
