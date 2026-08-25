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
 * Encoding wire types for values.
 *
 * Plain `as const` object instead of a TS `enum`: numeric enums compile to
 * an IIFE with a forward *and* reverse name mapping, which is pure dead
 * weight here since nothing ever looks up a wire type by name. This gives
 * the same call-site ergonomics (`WireType.String`) with none of that
 * generated code.
 */
export const WireType = {
    /** `null` */
    N: 0,
    /** `false` */
    F: 1,
    /** `true` */
    T: 2,
    /** A non-negative integer (zero or positive up to `Number.isSafeInteger()`) */
    P: 3,
    /** `number` */
    D: 4,
    /** typeof string */
    S: 5,
    /** typeof object */
    O: 6,
    /** typeof array */
    A: 7,
} as const
export type WireType = typeof WireType[keyof typeof WireType]

/**
 * Potential encoding formats:
 *
 * Normal formats (also called `VSON` format):
 *
 * * `KeyTable`
 *   * A representation of JSON in binary where all object keys are
 *     replaced with KeyIDs into a lookup table at the end of the
 *     encoded object. This means that every key is only encoded
 *     once.
 */
export const EncodingFormat_KeyTable = 1

export function getWireType(value: JSONValue): WireType {
    if (value === null) return WireType.N
    if (value === false) return WireType.F
    if (value === true) return WireType.T
    const t = typeof value
    if (t === 'number') {
        return Number.isInteger(value) && (value as number) >= 0 && Number.isSafeInteger(value) ? WireType.P : WireType.D
    }
    if (t === 'string') return WireType.S
    if (Array.isArray(value)) return WireType.A
    if (t === 'object') return WireType.O
    boom() // type invalid
}

export const textEncoder = new TextEncoder()
export const textDecoder = new TextDecoder('utf-8', { fatal: true })

/** Throws a `velojson: <msg>` error. Typed `never` so call sites can use it
 *  as an expression (`x = cond ? y : boom(...)`) as well as a statement. */
export function boom(): never {
    throw new Error('velojson encoding failure')
}

/**
 * Every packed varint header in the wire format is `low | (high << bits)`,
 * decoded with fast bitwise ops below 2^32 and div/mod above it (bitwise
 * ops truncate to 32 bits in JS). This one helper replaces four
 * copies of that same branch that used to live in byte_reader.ts.
 */
export function splitPacked(header: number, bits: number): [low: number, high: number] {
    const size = 1 << bits
    return [header % size, Math.floor(header / size)]
}