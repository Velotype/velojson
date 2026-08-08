/**
 * velojson (VSON) — binary encoder/decoder for JSON-representable data.
 */

import { EncodingFormat, WireType, type JSONValue } from "./common.ts"
import { decodeVSON, encodeVSON } from "./vson.ts"

export {
    WireType,
    EncodingFormat,
    type JSONValue
}

export const VSON = {
    encode: encodeVSON,
    decode: decodeVSON
}
