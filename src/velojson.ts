/**
 * velojson (VSON) — binary encoder/decoder for JSON-representable data.
 */

import { EncodingFormat, type VBINObjectMapper, WireType, type JSONValue } from "./common.ts"
import { VBINRootWriter, VBINObjectWriter, VBINArrayWriter, VBINHomogenousStringArrayWriter, VBINHomogenousPosIntArrayWriter, VBINHomogenousDoubleArrayWriter, VBINHomogenousObjectArrayWriter, VBINNumberArrayWriter } from "./encode_keyid.ts"
import { decodeVBIN, decodeVSON, encodeVSON } from "./vson.ts"

export {
    WireType,
    EncodingFormat,
    type JSONValue,

    type VBINObjectMapper,

    VBINRootWriter,
    VBINObjectWriter,
    VBINArrayWriter,
    VBINNumberArrayWriter,
    VBINHomogenousStringArrayWriter,
    VBINHomogenousPosIntArrayWriter,
    VBINHomogenousDoubleArrayWriter,
    VBINHomogenousObjectArrayWriter
}

export const VSON = {
    encode: encodeVSON,
    decode: decodeVSON
}

export const VBIN = {
    decode: decodeVBIN
}
