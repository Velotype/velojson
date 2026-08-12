import { type ByteWriter, acquireWriter, releaseWriter } from "./byte_writer.ts"
import { WireType, EncodingFormat } from "./common.ts"

export class VBINRootWriter {
    private writer: ByteWriter = acquireWriter()

    toUint8ArrayAndRelease(): Uint8Array<ArrayBufferLike> {
        const result = this.writer.toUint8Array().slice()
        releaseWriter(this.writer)
        return result
    }

    startRootObject(): VBINObjectWriter {
        return new VBINObjectWriter()
    }
    finalizeRootObject(childWriter: VBINObjectWriter): void {
        this.writer.writeVarint((EncodingFormat.KeyID * 8) + WireType.Object)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length)
        this.writer.writeBytes(body)
        childWriter.release()
    }

}

export class VBINObjectWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    encodeBooleanValue(key_id: number, value: boolean | undefined): void {
        if (value !== undefined) {
            if (value === true) {
                this.writer.writeVarint((key_id * 8) + WireType.True)
            } else {
                this.writer.writeVarint((key_id * 8) + WireType.False)
            }
        }
    }
    encodePosIntValue(key_id: number, value: number | undefined): void {
        if (value !== undefined) {
            this.writer.writeVarint((key_id * 8) + WireType.PosInt)
            this.writer.writeVarint(value)
        }
    }
    encodeDoubleValue(key_id: number, value: number | undefined): void {
        if (value !== undefined) {
            this.writer.writeVarint((key_id * 8) + WireType.Double)
            this.writer.writeDouble(value)
        }
    }
    encodeNumberValue(key_id: number, value: number | undefined): void {
        if (value !== undefined) {
            if (Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)) {
                this.writer.writeVarint((key_id * 8) + WireType.PosInt)
                this.writer.writeVarint(value)
            } else {
                this.writer.writeVarint((key_id * 8) + WireType.Double)
                this.writer.writeDouble(value)
            }
        }
    }
    encodeStringValue(key_id: number, value: string | undefined): void {
        if (value !== undefined) {
            this.writer.writeVarint((key_id * 8) + WireType.String)
            this.writer.writeString(value)
        }
    }
    finalizeObject(key_id: number, childWriter: VBINObjectWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Object)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeArray(key_id: number, childWriter: VBINArrayWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length * 2)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousStringArray(key_id: number, childWriter: VBINHomogenousStringArrayWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(((body.length + 1) * 2) + 1)
        this.writer.writeVarint(WireType.String)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousPosIntArray(key_id: number, childWriter: VBINHomogenousPosIntArrayWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(((body.length + 1) * 2) + 1)
        this.writer.writeVarint(WireType.PosInt)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousDoubleArray(key_id: number, childWriter: VBINHomogenousDoubleArrayWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(((body.length + 1) * 2) + 1)
        this.writer.writeVarint(WireType.Double)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousObjectArray(key_id: number, childWriter: VBINHomogenousObjectArrayWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(((body.length + 1) * 2) + 1)
        this.writer.writeVarint(WireType.Object)
        this.writer.writeBytes(body)
        childWriter.release()
    }
}

export class VBINArrayWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    encodeBooleanValueInArray(value: boolean): void {
        if (value === true) {
            this.writer.writeVarint(WireType.True)
        } else {
            this.writer.writeVarint(WireType.False)
        }
    }
    encodePosIntValue(value: number): void {
        if (value !== undefined) {
            this.writer.writeVarint(WireType.PosInt)
            this.writer.writeVarint(value)
        }
    }
    encodeDoubleValue(value: number): void {
        if (value !== undefined) {
            this.writer.writeVarint(WireType.Double)
            this.writer.writeDouble(value)
        }
    }
    encodeNumberValueInArray(value: number): void {
        if (Number.isInteger(value) && value as number >= 0 && Number.isSafeInteger(value)) {
            this.writer.writeVarint(WireType.PosInt)
            this.writer.writeVarint(value)
        } else {
            this.writer.writeVarint(WireType.Double)
            this.writer.writeDouble(value)
        }
    }
    encodeStringValueInArray(value: string): void {
        this.writer.writeVarint(WireType.String)
        this.writer.writeString(value)
    }
    finalizeObjectInArray(childWriter: VBINObjectWriter): void {
        this.writer.writeVarint(WireType.Object)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeArrayInArray(childWriter: VBINArrayWriter): void {
        this.writer.writeVarint(WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length * 2)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousStringArrayInArray(childWriter: VBINHomogenousStringArrayWriter): void {
        this.writer.writeVarint(WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.String)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousPosIntArrayInArray(childWriter: VBINHomogenousPosIntArrayWriter): void {
        this.writer.writeVarint(WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.PosInt)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousDoubleArrayInArray(childWriter: VBINHomogenousDoubleArrayWriter): void {
        this.writer.writeVarint(WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.Double)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousObjectArrayInArray(childWriter: VBINHomogenousObjectArrayWriter): void {
        this.writer.writeVarint(WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.Object)
        this.writer.writeBytes(body)
        childWriter.release()
    }

}

export class VBINHomogenousStringArrayWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    encodeStringValueInHomogenousArray(value: string): void {
        this.writer.writeString(value)
    }
}

export class VBINHomogenousPosIntArrayWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    encodePosIntValueInHomogenousArray(value: number): void {
        this.writer.writeVarint(value)
    }
}

export class VBINHomogenousDoubleArrayWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    encodeDoubleValueInHomogenousArray(value: number): void {
        this.writer.writeDouble(value)
    }
}

export class VBINHomogenousObjectArrayWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    finalizeObjectInHomogenousArray(childWriter: VBINObjectWriter) {
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length)
        this.writer.writeBytes(body)
        childWriter.release()
    }
}
