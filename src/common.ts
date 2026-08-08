

/**
 * Type representing encodable values (aka: plain JSON objects)
 */
export type JSONValue =
    | null
    | boolean
    | number
    | string
    | JSONValue[]
    | { [key: string]: JSONValue }

/**
 * Encoding wire types for values
 */
export enum WireType {
    /** `null` */
    Null = 0,
    /** `false` */
    False = 1,
    /** `true` */
    True = 2,
    /** A non-negative integer (zero or positive up to `Number.isSafeInteger()`) */
    PosInt = 3,
    /** `number` */
    Double = 4,
    /** typeof string */
    String = 5,
    /** typeof object */
    Object = 6,
    /** typeof array */
    Array = 7
}

/**
 * Potential encoding formats:
 * 
 * Normal formats (also called `VSON` format):
 * 
 * * `Base`
 *   * A direct 1-1 representation of JSON in binary.
 * 
 * * `StringTable`
 *   * A representation of JSON in binary where all object keys are
 *     replaced with KeyIDs into a lookup table at the end of the
 *     encoded object. This means that every key is only encoded
 *     once.
 * 
 * Advanced format (also called `VBIN` format):
 * 
 * * `KeyIDs`
 *   * An advanced representation of JSON in binary where all object keys
 *     are represented only by pre-determined KeyIDs. This means that the
 *     key names are not encoded in the payload and must be known a priori
 *     by the decoder.
 * 
 *     Using this format requires advanced usage of the encode/decode paths.
 * 
 */
export enum EncodingFormat {
    /** A direct 1-1 representation of JSON in binary. */
    Base = 0,
    /**
     * A representation of JSON in binary where all object keys are
     * replaced with KeyIDs into a lookup table at the end of the
     * encoded object. This means that every key is only encoded
     * once.
     */
    StringTable = 1,
    /**
     * An advanced representation of JSON in binary where all object keys
     * are represented only by pre-determined KeyIDs. This means that the
     * key names are not encoded in the payload and must be known a priori
     * by the decoder.
     * 
     * Using this format requires advanced usage of the encode/decode paths.
     */
    KeyIDs = 2
}

export function getWireType(value: JSONValue): WireType {
    const typeof_value = typeof value
    if (typeof_value === 'number') {
        if (Number.isInteger(value) && value as number >= 0 && Number.isSafeInteger(value)) {
            return WireType.PosInt
        }
        return WireType.Double // negatives, non-integers, NaN, Infinity, etc.
    }
    if (typeof_value === 'string') {
        return WireType.String
    }
    if (Array.isArray(value)) {
        return WireType.Array
    }
    if (value === null) {
        return WireType.Null
    }
    if (typeof_value === 'object') {
        return WireType.Object
    }
    if (value === false) {
        return WireType.False
    }
    if (value === true) {
        return WireType.True
    }
    throw new Error(`velojson: unsupported value type: ${typeof value}`)
}

/** 2^32 — the point past which bitwise ops (>>>, &) stop being safe/correct. */
export const UINT32_LIMIT = 0x100000000

export const textEncoder = new TextEncoder()
export const textDecoder = new TextDecoder()

/** Threshold for detection of homogenous arrays - arrays above this length will be tested for homogeneity */
export const HOMOGENEOUS_DETECTION_MIN_LENGTH = 64
