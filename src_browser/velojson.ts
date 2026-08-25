/**
 * velojson (VSON) — binary encoder/decoder for JSON-representable data.
 */

import { WireType, type JSONValue } from "./common.ts"
import { decodeVSON, encodeVSON } from "./vson.ts"

export {
    WireType,
    type JSONValue
}

export const VSON = {
    encode: encodeVSON,
    decode: decodeVSON
}
