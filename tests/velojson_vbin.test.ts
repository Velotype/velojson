// deno-lint-ignore-file no-explicit-any
import {
    VBIN,
    type VBINFieldKind,
    type VBINObjectMapper,
    VBINRootWriter,
    VBINObjectWriter,
    VBINArrayWriter,
    VBINNumberArrayWriter,
    VBINHomogenousStringArrayWriter,
    VBINHomogenousPosIntArrayWriter,
    VBINHomogenousDoubleArrayWriter,
    VBINHomogenousObjectArrayWriter,
} from '../src_server/velojson.ts'
import { describe, it } from "@std/testing/bdd"
import { assertEquals, assertThrows, fail } from "@std/assert"
import { deepEqual } from "./test_utils.ts"

// The main test suite's VBIN coverage (BigObjType) only exercises
// encodePosIntValue/encodeStringValue/encodeBooleanValue/encodeNumberValue
// and finalizeHomogenousStringArray/finalizeHomogenousObjectArray. This file
// covers the remaining VBIN writer/reader surface: encodeDoubleValue,
// finalizeObject (nested object field), finalizeArray (heterogeneous array),
// finalizeNumberArray (mixed int/double array), finalizeHomogenousPosIntArray,
// finalizeHomogenousDoubleArray, and the mapper-driven error paths
// (missing required field / unknown field keyID).

type Address = {
    city: string  // keyid = 1
    zip: string   // keyid = 2
}

type Product = {
    id: number                          // keyid = 1
    name: string                        // keyid = 2
    inStock: boolean                    // keyid = 3
    rating: number                      // keyid = 4 (written via encodeDoubleValue)
    tags: string[]                      // keyid = 5 (homogeneous string array)
    ids: number[]                       // keyid = 6 (homogeneous posint array)
    weights: number[]                   // keyid = 7 (homogeneous double array)
    misc: (boolean | number | string)[] // keyid = 8 (heterogeneous array)
    counts: number[]                    // keyid = 9 (mixed int/double array)
    address: Address                    // keyid = 10 (nested object)
}

function encodeAddress(w: VBINObjectWriter, a: Address): void {
    w.encodeStringValue(1, a.city)
    w.encodeStringValue(2, a.zip)
}

function encodeProduct(w: VBINObjectWriter, p: Product): void {
    w.encodePosIntValue(1, p.id)
    w.encodeStringValue(2, p.name)
    w.encodeBooleanValue(3, p.inStock)
    w.encodeDoubleValue(4, p.rating)

    const tags = new VBINHomogenousStringArrayWriter()
    p.tags.forEach(t => tags.encodeStringValueInHomogenousArray(t))
    w.finalizeHomogenousStringArray(5, tags)

    const ids = new VBINHomogenousPosIntArrayWriter()
    p.ids.forEach(id => ids.encodePosIntValueInHomogenousArray(id))
    w.finalizeHomogenousPosIntArray(6, ids)

    const weights = new VBINHomogenousDoubleArrayWriter()
    p.weights.forEach(wt => weights.encodeDoubleValueInHomogenousArray(wt))
    w.finalizeHomogenousDoubleArray(7, weights)

    const misc = new VBINArrayWriter()
    p.misc.forEach(m => {
        if (typeof m === 'boolean') misc.encodeBooleanValueInArray(m)
        else if (typeof m === 'number') misc.encodeNumberValueInArray(m)
        else misc.encodeStringValueInArray(m)
    })
    w.finalizeArray(8, misc)

    const counts = new VBINNumberArrayWriter()
    p.counts.forEach(c => counts.encodeNumberValueInArray(c))
    w.finalizeNumberArray(9, counts)

    const addressWriter = new VBINObjectWriter()
    encodeAddress(addressWriter, p.address)
    w.finalizeObject(10, addressWriter)
}

function encodeProductRoot(p: Product): Uint8Array {
    const root = new VBINRootWriter()
    const obj = root.startRootObject()
    encodeProduct(obj, p)
    root.finalizeRootObject(obj)
    return root.toUint8ArrayAndRelease()
}

const AddressMapper: VBINObjectMapper = {
    assignValue: (o: any, keyID: number, value: any): void => {
        switch (keyID) {
            case 1: o.city = value; break
            case 2: o.zip = value; break
        }
    },
    fieldKind: () => "value" as const,
    hasAllRequiredFields: (o: any): boolean => o.city !== undefined && o.zip !== undefined,
    fieldMapper: (): VBINObjectMapper | undefined => undefined,
}

const REQUIRED_PRODUCT_FIELDS = ['id', 'name', 'inStock', 'rating', 'tags', 'ids', 'weights', 'misc', 'counts', 'address']

const ProductMapper: VBINObjectMapper = {
    assignValue: (o: any, keyID: number, value: any): void => {
        switch (keyID) {
            case 1: o.id = value; break
            case 2: o.name = value; break
            case 3: o.inStock = value; break
            case 4: o.rating = value; break
            case 5: o.tags = value; break
            case 6: o.ids = value; break
            case 7: o.weights = value; break
            case 8: o.misc = value; break
            case 9: o.counts = value; break
            case 10: o.address = value; break
        }
    },
    fieldKind: () => "value" as const,
    hasAllRequiredFields: (o: any): boolean => REQUIRED_PRODUCT_FIELDS.every(k => o[k] !== undefined),
    fieldMapper: (keyID: number): VBINObjectMapper | undefined => keyID === 10 ? AddressMapper : undefined,
}

const ProductMapperNoAddressMapper: VBINObjectMapper = {
    ...ProductMapper,
    fieldMapper: (): VBINObjectMapper | undefined => undefined,
}

const sampleProduct: Product = {
    id: 42,
    name: 'Widget',
    inStock: true,
    rating: 4.5,
    tags: ['new', 'sale', 'featured'],
    ids: [1, 2, 3, 5, 8, 13, 21],
    weights: [1.1, 2.25, 3.5],
    misc: [true, false, 7, -2.5, 'note'],
    counts: [1, 2, 3.5, 4, 5.75],
    address: { city: 'Springfield', zip: '00000' },
}

describe('VBIN advanced writer/reader API', () => {

    it('round-trips every writer class through VBIN.decode with a mapper', () => {
        const encoded = encodeProductRoot(sampleProduct)
        const decoded = VBIN.decode(encoded, ProductMapper)
        if (!deepEqual(decoded, sampleProduct, true)) {
            console.error('Expected:', JSON.stringify(sampleProduct))
            console.error('Actual:  ', JSON.stringify(decoded))
            fail('ERROR: VBIN full-feature round trip failed')
        }
    })

    it('encodeDoubleValue always uses the Double wire type, even for whole numbers', () => {
        const root = new VBINRootWriter()
        const obj = root.startRootObject()
        obj.encodeDoubleValue(1, 5) // whole number, but forced to Double
        root.finalizeRootObject(obj)
        const bytes = root.toUint8ArrayAndRelease()
        // header: (KeyID=2 * 8) + Object(6) = 22
        // body length: 1 field-header byte + 8 double bytes = 9
        // field header: (keyID=1 * 8) + Double(4) = 12
        assertEquals(Array.from(bytes.slice(0, 3)), [22, 9, 12])
        assertEquals(bytes.length, 11) // header + bodyLen + 9-byte body
    })

    it('throws when a required field is missing', () => {
        const root = new VBINRootWriter()
        const obj = root.startRootObject()
        obj.encodePosIntValue(1, 1) // only `id`, everything else omitted
        root.finalizeRootObject(obj)
        const encoded = root.toUint8ArrayAndRelease()
        assertThrows(() => VBIN.decode(encoded, ProductMapper), Error, 'missing required field')
    })

    it('throws on an unknown field keyID for a nested object field', () => {
        const encoded = encodeProductRoot(sampleProduct)
        assertThrows(() => VBIN.decode(encoded, ProductMapperNoAddressMapper), Error, 'unknown field keyID')
    })

    it('throws on an unknown field keyID for a homogeneous object array', () => {
        const root = new VBINRootWriter()
        const obj = root.startRootObject()
        const arr = new VBINHomogenousObjectArrayWriter()
        const itemWriter = new VBINObjectWriter()
        itemWriter.encodePosIntValue(1, 1)
        arr.finalizeObjectInHomogenousArray(itemWriter)
        obj.finalizeHomogenousObjectArray(1, arr)
        root.finalizeRootObject(obj)
        const encoded = root.toUint8ArrayAndRelease()

        const noFieldMapper: VBINObjectMapper = {
            assignValue: () => {},
            fieldKind: () => "value" as const,
            hasAllRequiredFields: () => true,
            fieldMapper: () => undefined,
        }
        assertThrows(() => VBIN.decode(encoded, noFieldMapper), Error, 'unknown field keyID')
    })
})

describe('VBIN field kinds', () => {
    // Field 1 is known, field 2 holds `write`'s value, field 3 is known and written last
    const MARK = "ZQZQ"
    const NOT_UTF8 = new Uint8Array([0xff, 0xfe, 0x80, 0xc0])
    function message(write: (w: VBINObjectWriter) => void, last = "end"): Uint8Array {
        const root = new VBINRootWriter()
        const obj = root.startRootObject()
        obj.encodePosIntValue(1, 7)
        write(obj)
        obj.encodeStringValue(3, last)
        root.finalizeRootObject(obj)
        return root.toUint8ArrayAndRelease()
    }
    /** Every MARK in `bytes` overwritten with bytes that aren't UTF-8 */
    function corrupt(bytes: Uint8Array): Uint8Array {
        const out = bytes.slice()
        let found = 0
        for (let i = 0; i + MARK.length <= out.length; i++) {
            if (String.fromCharCode(...out.subarray(i, i + MARK.length)) === MARK) {
                out.set(NOT_UTF8, i)
                found++
            }
        }
        assertEquals(found > 0, true)
        return out
    }
    const Skip: VBINObjectMapper = {
        assignValue: (): void => {},
        hasAllRequiredFields: (): boolean => true,
        fieldMapper: (): VBINObjectMapper => Skip,
        fieldKind: () => "skip",
    }
    const Nested: VBINObjectMapper = {
        assignValue: (): void => {},
        hasAllRequiredFields: (): boolean => true,
        fieldMapper: (): VBINObjectMapper => Skip,
        fieldKind: () => "value",
    }
    function reader(field2: VBINFieldKind): VBINObjectMapper {
        return {
            assignValue: (o: any, keyID: number, value: any): void => {
                if (keyID === 1) { o.id = value } else if (keyID === 2) { o.field2 = value } else if (keyID === 3) { o.last = value }
            },
            hasAllRequiredFields: (): boolean => true,
            fieldMapper: (): VBINObjectMapper => field2 === "skip" ? Skip : Nested,
            fieldKind: (keyID: number) => keyID === 2 ? field2 : "value",
        }
    }
    const decoded = (bytes: Uint8Array, kind: VBINFieldKind): any => ({...VBIN.decode(bytes as Uint8Array<ArrayBuffer>, reader(kind)) as any})

    const values: [string, (w: VBINObjectWriter) => void][] = [
        ['a string', w => w.encodeStringValue(2, MARK)],
        ['a homogeneous string array', w => {
            const tags = new VBINHomogenousStringArrayWriter()
            tags.encodeStringValueInHomogenousArray(MARK)
            tags.encodeStringValueInHomogenousArray(MARK)
            w.finalizeHomogenousStringArray(2, tags)
        }],
        ['a mixed array', w => {
            const misc = new VBINArrayWriter()
            misc.encodeBooleanValueInArray(true)
            misc.encodeStringValueInArray(MARK)
            w.finalizeArray(2, misc)
        }],
        ['a nested object', w => {
            const nested = new VBINObjectWriter()
            nested.encodeStringValue(1, MARK)
            w.finalizeObject(2, nested)
        }],
        ['an array of objects', w => {
            const nested = new VBINObjectWriter()
            nested.encodeStringValue(1, MARK)
            const arr = new VBINHomogenousObjectArrayWriter()
            arr.finalizeObjectInHomogenousArray(nested)
            w.finalizeHomogenousObjectArray(2, arr)
        }],
    ]
    for (const [what, write] of values) {
        it(`"skip" moves past ${what} that isn't UTF-8, and reads on`, () => {
            const value = decoded(corrupt(message(write)), "skip")
            assertEquals([value.id, value.last], [7, "end"])
        })
        it(`"value" refuses ${what} that isn't UTF-8`, () => {
            assertThrows(() => decoded(corrupt(message(write)), "value"))
        })
    }
    it("still refuses a known field that isn't UTF-8, after a skipped one", () => {
        assertThrows(() => decoded(corrupt(message(w => w.encodeStringValue(2, "fine"), MARK)), "skip"))
    })
    it('still checks the structure of a skipped field', () => {
        const bytes = message(w => w.encodeStringValue(2, MARK))
        assertThrows(() => decoded(bytes.subarray(0, bytes.length - 8), "skip"))
    })

    it('"bytes" hands over raw bytes that aren\'t UTF-8', () => {
        const value = decoded(message(w => w.encodeBytesValue(2, NOT_UTF8)), "bytes")
        assertEquals([value.id, value.last], [7, "end"])
        assertEquals(value.field2, NOT_UTF8)
    })
    it('"bytes" is raw on the wire: the payload itself, with no base64', () => {
        const bytes = message(w => w.encodeBytesValue(2, NOT_UTF8))
        assertEquals(bytes.join().includes(NOT_UTF8.join()), true)
    })
    it('"bytes" gives a copy, not a view of the message', () => {
        const bytes = message(w => w.encodeBytesValue(2, NOT_UTF8))
        const value = decoded(bytes, "bytes")
        bytes.fill(0)
        assertEquals(value.field2, NOT_UTF8)
        assertEquals(value.field2.buffer.byteLength, NOT_UTF8.length)
    })
    it('"bytes" takes no bytes at all', () => {
        assertEquals(decoded(message(w => w.encodeBytesValue(2, new Uint8Array(0))), "bytes").field2, new Uint8Array(0))
    })
    it('"bytes" takes an array of them', () => {
        const arr = new VBINHomogenousStringArrayWriter()
        arr.encodeBytesValueInHomogenousArray(NOT_UTF8)
        arr.encodeBytesValueInHomogenousArray(new Uint8Array(0))
        const value = decoded(message(w => w.finalizeHomogenousStringArray(2, arr)), "bytes")
        assertEquals(value.field2, [NOT_UTF8, new Uint8Array(0)])
    })
    it('"value" refuses raw bytes that aren\'t UTF-8', () => {
        assertThrows(() => decoded(message(w => w.encodeBytesValue(2, NOT_UTF8)), "value"))
    })
    it('an older reader skips raw bytes', () => {
        const value = decoded(message(w => w.encodeBytesValue(2, NOT_UTF8)), "skip")
        assertEquals([value.id, value.last], [7, "end"])
    })
    it('writing what isn\'t bytes throws, as the native codec does', () => {
        const notBytes = [1, 2] as unknown as Uint8Array
        assertThrows(() => message(w => w.encodeBytesValue(2, notBytes)), TypeError)
        assertThrows(() => new VBINHomogenousStringArrayWriter().encodeBytesValueInHomogenousArray(notBytes), TypeError)
    })
    it('a field after "bytes" reads as usual', () => {
        assertThrows(() => decoded(corrupt(message(w => w.encodeBytesValue(2, NOT_UTF8), MARK)), "bytes"))
    })
})
