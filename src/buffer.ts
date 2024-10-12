import * as THREE from 'three'
import * as BBO from 'buffer-backed-object';

type BufferDescriptor = Partial<Omit<GPUBufferDescriptor, 'size'>>;

export class Buffer<T extends THREE.TypedArray> {
    buffer: GPUBuffer;
    constructor(public device: GPUDevice, public array: T, desc: BufferDescriptor & Pick<GPUBufferDescriptor, 'usage'>) {
        this.buffer = device.createBuffer({
            size: array.byteLength,
            ...desc,
        });
    }

    write(data = this.array, bufferOffset = 0, dataOffset?: number, size?: number) {
        this.device.queue.writeBuffer(this.buffer, bufferOffset, data, dataOffset, size);
        return this;
    }
}

export class StorageBuffer<T extends THREE.TypedArray> extends Buffer<T> {
    count = 0; // item count

    get offset() {
        return this.count * this.byteStride * this.itemSize;
    }

    get elementOffset() {
        return this.count * this.itemSize;
    }

    constructor(device: GPUDevice, array: T, public byteStride: number, public itemSize = 1, desc?: BufferDescriptor) {
        super(device, array, {
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            ...desc,
        });
    }

    append(data: T, bufferOffset = this.offset, dataOffset = 0, size?: number) {
        this.write(data, bufferOffset, dataOffset, size);
        this.count += data.byteLength / (this.byteStride * this.itemSize);
        return this;
    }

    writeRange(idxOffset = 0, count = 0, data = this.array) {
        // this.write(data, idxOffset * this.byteStride * this.itemSize, idxOffset * this.itemSize, count * this.itemSize * this.byteStride);
        this.write(data, idxOffset * this.byteStride * this.itemSize, idxOffset * this.itemSize, count * this.itemSize);
    }
}

export class IndirectBuffer extends StorageBuffer<Uint32Array> {
    static isize = 4;
    view: BBO.DecodedBuffer<{
        indexCount: BBO.Descriptor<number>;
        instanceCount: BBO.Descriptor<number>;
        indexOffset: BBO.Descriptor<number>;
        objectId: BBO.Descriptor<number>;
    }>[];

    constructor(device: GPUDevice, public entityCount: number, desc?: BufferDescriptor) {
        super(device, new Uint32Array(entityCount * 4 * IndirectBuffer.isize), 4, IndirectBuffer.isize, {
            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
            ...desc,
        });

        this.view = BBO.ArrayOfBufferBackedObjects(this.array.buffer, {
            indexCount: BBO.Uint32(),
            instanceCount: BBO.Uint32(),
            indexOffset: BBO.Uint32(),
            objectId: BBO.Uint32(),
        })

    }
}

export class MatrixBuffer extends Buffer<Float32Array> {
    bindGroup: GPUBindGroup;
    constructor(device: GPUDevice, public matrix: THREE.Matrix4, desc?: BufferDescriptor) {
        const array = new Float32Array(matrix.elements);
        super(device, array, {
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            ...desc,
        });
    }
    write(data?: Float32Array, bufferOffset?: number, dataOffset?: number, size?: number): this {
        this.array.set(this.matrix.elements);
        super.write(data, bufferOffset, dataOffset, size);
        return this;
    }
}

export class VertexBuffer extends Buffer<THREE.TypedArray> {
    constructor(device: GPUDevice, public attr: THREE.BufferAttribute, desc?: BufferDescriptor) {
        const array = attr.array;
        super(device, array, {
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            ...desc,
        });
        this.write();
    }
}
export class IndexBuffer extends Buffer<THREE.TypedArray> {
    constructor(device: GPUDevice, public geometry: THREE.BufferGeometry, desc?: BufferDescriptor) {
        let array = geometry.index.array;
        if (array instanceof Uint16Array) {
            // array = new Uint32Array(array);
        }
        console.log(array.byteLength % 4);
        super(device, array, {
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            ...desc,
        });
        this.write(this.array, 0, 0, this.array.length);
        // this.write(this.array);
    }
}
