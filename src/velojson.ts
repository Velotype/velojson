/**
 * velojson (VSON) — binary encoder/decoder for JSON-representable data.
 */

import { EncodingFormat, WireType, type JSONValue } from "./common.ts"
import { VBINRootWriter, VBINObjectWriter, VBINArrayWriter, VBINHomogenousStringArrayWriter, VBINHomogenousPosIntArrayWriter, VBINHomogenousDoubleArrayWriter, VBINHomogenousObjectArrayWriter } from "./encode_keyids.ts"
import { decodeVSON, encodeVSON } from "./vson.ts"

export {
    WireType,
    EncodingFormat,
    type JSONValue,

    VBINRootWriter,
    VBINObjectWriter,
    VBINArrayWriter,
    VBINHomogenousStringArrayWriter,
    VBINHomogenousPosIntArrayWriter,
    VBINHomogenousDoubleArrayWriter,
    VBINHomogenousObjectArrayWriter
}

export const VSON = {
    encode: encodeVSON,
    decode: decodeVSON
}
