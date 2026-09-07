// deno-lint-ignore-file no-explicit-any
import {
    VBIN,
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
            hasAllRequiredFields: () => true,
            fieldMapper: () => undefined,
        }
        assertThrows(() => VBIN.decode(encoded, noFieldMapper), Error, 'unknown field keyID')
    })
})
