import { textEncoder, UINT32_LIMIT } from "./common.ts"


/** Limites size of a pool of ByteWriter objects */
const WRITER_POOL_LIMIT = 1024

/** A reusable pool of ByteWriter objects for performance */
const writerPool: ByteWriter[] = []

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export class ByteWriter {
    private buf: Uint8Array
    /** Cached DataView over the current backing buffer */
    private bufView: DataView
    private len = 0

    constructor(initialCapacity = 64) {
        this.buf = new Uint8Array(initialCapacity)
        this.bufView = new DataView(this.buf.buffer)
    }

    private ensureCapacity(extra: number): void {
        const needed = this.len + extra
        if (needed <= this.buf.length) {
            return
        }
        let newCap = this.buf.length * 2 || 64
        while (newCap < needed) {
            newCap *= 2
        }
        const newBuf = new Uint8Array(newCap)
        newBuf.set(this.buf.subarray(0, this.len))
        this.buf = newBuf
        this.bufView = new DataView(this.buf.buffer) // buffer identity changed — must refresh
    }

    writeByte(b: number): void {
        this.ensureCapacity(1)
        this.buf[this.len++] = b & 0xff
    }

    writeBytes(bytes: Uint8Array): void {
        this.ensureCapacity(bytes.length)
        this.buf.set(bytes, this.len)
        this.len += bytes.length
    }

    /** LEB128-style unsigned varint. Requires a safe, non-negative integer. */
    writeVarint(value: number): void {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`writeVarint: expected a non-negative integer, got ${value}`)
        }
        if (!Number.isSafeInteger(value)) {
            throw new Error(`writeVarint: value ${value} exceeds safe integer range`)
        }

        // Fast path: single-byte varint (values 0-127). Very common — every
        // object-key header with a short key name lands here, as does any
        // small integer field.
        if (value < 128) {
            this.writeByte(value)
            return
        }

        this.ensureCapacity(10) // worst case for a 53-bit safe integer

        if (value < UINT32_LIMIT) {
            // Bitwise ops are safe here: >>> and & both operate correctly
            // on the low 32 bits regardless of sign interpretation, for
            // any value that actually fits in 32 bits.
            let v = value >>> 0
            do {
                let byte = v & 0x7f
                v >>>= 7
                if (v !== 0) {
                    byte |= 0x80
                }
                this.buf[this.len++] = byte
            } while (v !== 0)
        } else {
            // Slow path (only reached above 2^32-1): identical algorithm to
            // the above, div/mod based, since bitwise ops would truncate.
            let v = value
            do {
                let byte = v % 128
                v = Math.floor(v / 128)
                if (v !== 0) {
                    byte |= 0x80
                }
                this.buf[this.len++] = byte
            } while (v !== 0)
        }
    }

    writeDouble(value: number): void {
        this.ensureCapacity(8)
        this.bufView.setFloat64(this.len, value, true)
        this.len += 8
    }

    writeString(str: string): void {
        const bytes = textEncoder.encode(str)
        this.writeVarint(bytes.length)
        this.writeBytes(bytes)
    }

    /** Zero-copy view of the written bytes. Valid until this writer is written to again. */
    toUint8Array(): Uint8Array {
        return this.buf.subarray(0, this.len)
    }

    get length(): number {
        return this.len
    }

    /** Reuse this writer for a new value: keeps the backing buffer (and its
     *  already-sized capacity) but discards previously written content. */
    reset(): void {
        this.len = 0
    }
}

export function acquireWriter(): ByteWriter {
    const writer = writerPool.pop()
    if (writer !== undefined) {
        writer.reset()
        return writer
    }
    return new ByteWriter()
}

export function releaseWriter(writer: ByteWriter): void {
    if (writerPool.length < WRITER_POOL_LIMIT) {
        writerPool.push(writer)
    }
}

