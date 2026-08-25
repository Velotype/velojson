import { boom, textEncoder } from "./common.ts"

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Not part of the package's public interface (only reached internally via
 * `acquireWriter`/`releaseWriter`, never re-exported from velojson.ts), so
 * fields/methods are named for minified size rather than readability:
 */
export class ByteWriter {
    /** buf */
    private b: Uint8Array
    /** bufView - Cached DataView over the current backing buffer */
    private w: DataView
    /** len */
    private n = 0

    constructor(initialCapacity = 64) {
        this.b = new Uint8Array(initialCapacity)
        this.w = new DataView(this.b.buffer)
    }

    #ensureCapacity(extra: number): void {
        const needed = this.n + extra
        if (needed <= this.b.length) {
            return
        }
        let newCap = this.b.length * 2 || 64
        while (newCap < needed) {
            newCap *= 2
        }
        const newBuf = new Uint8Array(newCap)
        newBuf.set(this.b.subarray(0, this.n))
        this.b = newBuf
        this.w = new DataView(this.b.buffer) // buffer identity changed — must refresh
    }

    /** writeByte */
    wb(b: number): void {
        this.#ensureCapacity(1)
        this.b[this.n++] = b & 0xff
    }

    /** writeBytes */
    wn(bytes: Uint8Array): void {
        this.#ensureCapacity(bytes.length)
        this.b.set(bytes, this.n)
        this.n += bytes.length
    }

    /** writeVarint - LEB128-style unsigned varint. Requires a safe, non-negative integer. */
    wv(value: number): void {
        if (!Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
            boom() // 'value invalid'
        }

        this.#ensureCapacity(10) // worst case for a 53-bit safe integer

        let v = value
        do {
            let byte = v % 128
            v = Math.floor(v / 128)
            if (v !== 0) {
                byte |= 0x80
            }
            this.b[this.n++] = byte
        } while (v !== 0)
    }

    /** writeDouble */
    wd(value: number): void {
        this.#ensureCapacity(8)
        this.w.setFloat64(this.n, value, true)
        this.n += 8
    }

    /** writeSTring */
    ws(str: string): void {
        const bytes = textEncoder.encode(str)
        this.wv(bytes.length)
        this.wn(bytes)
    }

    /** toUint8Array - Zero-copy view of the written bytes. Valid until this writer is written to again. */
    u8(): Uint8Array {
        return this.b.subarray(0, this.n)
    }

}

export function acquireWriter(): ByteWriter {
    return new ByteWriter()
}
