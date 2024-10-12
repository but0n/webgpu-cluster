import * as THREE from 'three'
import main_shader from './shaders/main.wgsl';
import { Buffer, IndexBuffer, IndirectBuffer, MatrixBuffer, StorageBuffer, VertexBuffer } from './buffer';
import { SSAO } from './ssao';

type Entity = {
    objectId: number; // offset
    indexOffset: number;
    indexCount: number;
    // vertexOffset: number;
    // vertexCount: number;
}

export class EntityMgr {
    objectMap: WeakMap<THREE.Object3D, Entity> = new WeakMap();
    vertexBuffer: StorageBuffer<Float32Array>;
    indexBuffer: StorageBuffer<Uint32Array>;
    matrixBuffer: StorageBuffer<Float32Array>;
    bindGroup: GPUBindGroup;
    batchBuffer: IndirectBuffer;
    constructor(private device: GPUDevice) {
        const bufferSize = 134217728 / 4 / 2;
        this.matrixBuffer = new StorageBuffer(device, new Float32Array(bufferSize), 4, 16, {'label': 'matrix buffer'});
        this.vertexBuffer = new StorageBuffer(device, new Float32Array(bufferSize), 4, 3 + 3);
        this.indexBuffer = new StorageBuffer(device, new Uint32Array(bufferSize), 4); // FIXME: 3?
        this.batchBuffer = new IndirectBuffer(device, 2 ** 16);
    }

    bindToPipeline(pipeline: GPURenderPipeline) {
        this.bindGroup = this.device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.matrixBuffer.buffer,
                    }
                },
                {
                    binding: 1,
                    resource: {
                        buffer: this.vertexBuffer.buffer,
                    }
                },
                {
                    binding: 2,
                    resource: {
                        buffer: this.indexBuffer.buffer,
                    }
                },
            ],
        });
        return this.bindGroup;
    }

    registerObject(obj: THREE.Mesh) {
        const position = obj.geometry.getAttribute('position')?.array;
        let index = obj.geometry.index?.array;

        if (index == null) {
            index = new Uint32Array(position.length / 3);
            for (let i = 0; i < index.length; i++) {
                index[i] = i;
            }
        }

        const entity: Entity = {
            objectId: this.matrixBuffer.count++,
            indexOffset: this.indexBuffer.count,
            indexCount: obj.geometry?.index?.count,
            // vertexOffset: this.vertexBuffer.count,
            // vertexCount: obj.geometry?.getAttribute('position')?.count,
        };

        // if (index instanceof Uint32Array) {
        //     debugger
        //     this.indexBuffer.append(index);
        if (index) {
            for (let i = 0; i < index.length; i++) {
                this.indexBuffer.array[i + this.indexBuffer.elementOffset] = index[i] + this.vertexBuffer.count;
            }
            this.indexBuffer.writeRange(this.indexBuffer.count, index.length);
            this.indexBuffer.count += index.length;
        }

        if (position instanceof Float32Array) {
            if (!obj.geometry.hasAttribute('normal')) {
                obj.geometry.computeVertexNormals();
            }
            const position = obj.geometry?.getAttribute('position');
            const normal = obj.geometry?.getAttribute('normal');
            const elementOffset = this.vertexBuffer.elementOffset;
            for (let i = 0; i < position.count; i++) {
                this.vertexBuffer.array.set([
                    position.getX(i), position.getY(i), position.getZ(i),
                    normal.getX(i), normal.getY(i), normal.getZ(i),
                ], elementOffset + i * this.vertexBuffer.itemSize);
            }
            this.vertexBuffer.writeRange(this.vertexBuffer.count, position.count);
            this.vertexBuffer.count += position.count;
            // this.vertexBuffer.array.set(position, this.vertexBuffer.count * this.vertexBuffer.itemSize);
            // this.vertexBuffer.append(position);
        }

        if (position instanceof Float32Array && index.byteLength > 0) {
            this.batchBuffer.array.set([
                entity.indexCount,  // vertex count
                1,                  // instance count
                entity.indexOffset, // first vertex
                entity.objectId,    // first instance
            ], this.batchBuffer.elementOffset);
            this.batchBuffer.writeRange(this.batchBuffer.count, 1);
            this.batchBuffer.count++;
        } else {
            debugger
        }
        // this.vertexBuffer.pointer += position.byteLength;
        // this.indexBuffer.pointer += index.byteLength;
        // this.matrixBuffer.pointer += 16 * 4;

        return entity;
    }

    updateObject(obj: THREE.Object3D) {
        if (obj == null) return;
        if (!this.objectMap.has(obj) && obj instanceof THREE.Mesh) {
            const entity = this.registerObject(obj);
            this.objectMap.set(obj, entity);
            obj.matrixWorld.toArray(this.matrixBuffer.array, entity.objectId * this.matrixBuffer.itemSize);
            this.matrixBuffer.writeRange(entity.objectId, 1);
        }
        const entity = this.objectMap.get(obj);
        if (entity) {
            // update world matrix
            obj.updateWorldMatrix(true, true);
            obj.matrixWorld.toArray(this.matrixBuffer.array, entity.objectId * this.matrixBuffer.itemSize);
            this.matrixBuffer.writeRange(entity.objectId, 1);
        }
        return entity;
    }
}

export class Renderer {

    presentationFormat: GPUTextureFormat;
    device: GPUDevice;
    context: GPUCanvasContext;
    renderPassDescriptor: GPURenderPassDescriptor;
    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;
    entityMgr: EntityMgr;
    ssao: SSAO;

    constructor(private canvas: HTMLCanvasElement) {}

    async init() {
        try {
            const adapter = await navigator.gpu?.requestAdapter();
            const device = this.device = await adapter.requestDevice({
                requiredFeatures: ['indirect-first-instance'],
            });

            // this.presentationFormat = navigator.gpu?.getPreferredCanvasFormat();
            this.presentationFormat = 'rgba16float';
            const context = this.context = this.canvas.getContext('webgpu');
            context.configure({
                device,
                colorSpace: 'srgb',
                format: this.presentationFormat,
                toneMapping: {mode: 'extended'},
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
        } catch (e) {
            alert('WebGPU is not supported on this device');
            console.error('WebGPU is not supported on this device', e);
            return this;
        }

        this.default_pipeline = this.createPipeline('fs');
        this.wireframe_pipeline = this.createPipeline('wire_fs', 'line-list');

        // depth resources
        const depthTexture = this.depthTexture = this.device.createTexture({
            label: 'depth texture',
            size: {
                width: this.canvas.width,
                height: this.canvas.height,
                depthOrArrayLayers: 1,
            },
            format: 'depth24plus-stencil8',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        this.depthTextureView = depthTexture.createView();

        this.renderPassDescriptor = {
            label: 'render pass descriptor',
            colorAttachments: [
                {
                    view: null,
                    clearValue: [0, 0, 0, 1],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                stencilLoadOp: 'clear',
                stencilStoreOp: 'discard',
            }
        };

        this.entityMgr = new EntityMgr(this.device);
        console.log({entity: this.entityMgr});
        this.entityMgr.bindToPipeline(this.default_pipeline);

        this.ssao = new SSAO(this.device, this.presentationFormat, this.depthTexture);

        return this;
    }


    default_pipeline: GPURenderPipeline;
    wireframe_pipeline: GPURenderPipeline;

    createPipeline(fs: string, topology: GPUPrimitiveTopology = 'triangle-list') {
        const { device } = this;
        const module = device.createShaderModule({
            label: 'defalut shader module',
            code: main_shader,
        });

        const pipeline = device.createRenderPipeline({
            label: 'test pipeline',
            layout: 'auto',
            vertex: {
                module,
                entryPoint: 'vs',
                buffers: [
                    // {
                    //     arrayStride: 3 * 4,
                    //     attributes: [
                    //         { shaderLocation: 0, offset: 0, format: 'float32x3' } // position
                    //     ]
                    // },
                    // {
                    //     arrayStride: 3 * 4,
                    //     attributes: [
                    //         { shaderLocation: 1, offset: 0, format: 'float32x3' } // normal
                    //     ]
                    // },
                    // {
                    //     arrayStride: 6 * 4,
                    //     stepMode: 'instance',
                    //     attributes: [
                    //         { shaderLocation: 1, offset: 0, format: 'float32x3' },
                    //         { shaderLocation: 2, offset: 12, format: 'float32x3' },
                    //     ]
                    // },
                    // {
                    //     arrayStride: 3 * 4,
                    //     attributes: [
                    //         { shaderLocation: 3, offset: 0, format: 'float32x3' } // normal
                    //     ]
                    // },
                ]
            },
            fragment: {
                module,
                entryPoint: fs,
                targets: [
                    {
                        format: this.presentationFormat,
                        // blend: {
                        //     color: {
                        //         srcFactor: 'src-alpha',
                        //         dstFactor: 'one-minus-src-alpha',
                        //     },
                        //     alpha: {
                        //         srcFactor: 'one',
                        //         dstFactor: 'one',
                        //     }
                        // },
                    }
                ]
            },
            primitive: {
                topology,
                cullMode: 'none',
            },
            depthStencil: {
                depthWriteEnabled: true,
                format: 'depth24plus-stencil8',
                depthCompare: 'less-equal',
                // depthCompare: 'always',
            }
        });

        return pipeline;
    }

    GPUBufferMap: WeakMap<ArrayBuffer, GPUBuffer> = new WeakMap();
    cameraBuffer: WeakMap<THREE.Camera, MatrixBuffer> = new WeakMap();

    cameraBindGroup: GPUBindGroup;

    updateCameraBuffer(camera: THREE.Camera) {
        const { device } = this;
        if (!this.cameraBuffer.has(camera)) {
            const buffer = new MatrixBuffer(device, new THREE.Matrix4()).write();
            this.cameraBuffer.set(camera, buffer);
            buffer.bindGroup = device.createBindGroup({
                layout: this.default_pipeline.getBindGroupLayout(1),
                entries: [
                    {
                        binding: 0,
                        resource: { buffer: buffer.buffer }
                    },
                ],
            });
        }
        const buffer = this.cameraBuffer.get(camera);
        camera.updateWorldMatrix(true, false);
        buffer.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        buffer.write();
        return buffer;
    }

    private objectVertexBufferCache: WeakMap<THREE.Object3D, VertexBuffer[]> = new WeakMap();

    getObjectVertexBuffer(obj: THREE.Object3D) {
        const { device } = this;
        if (obj instanceof THREE.Mesh) {
            if (!this.objectVertexBufferCache.has(obj)) {
                const { geometry } = obj as THREE.Mesh;
                if (!geometry.hasAttribute('normal')) {
                    geometry.computeVertexNormals();
                }
                if (geometry.hasAttribute('position')) {
                    this.objectVertexBufferCache.set(obj, [
                        new VertexBuffer(device, geometry.getAttribute('position') as THREE.BufferAttribute),
                        new VertexBuffer(device, geometry.getAttribute('normal') as THREE.BufferAttribute),
                    ]);
                }
            }
            return this.objectVertexBufferCache.get(obj);
        }
    }

    private objectIndexBufferCache: WeakMap<THREE.Object3D, IndexBuffer> = new WeakMap();

    getObjectIndexBuffer(obj: THREE.Object3D) {
        const { device } = this;
        if (obj instanceof THREE.Mesh) {
            if (!this.objectIndexBufferCache.has(obj)) {
                const { geometry } = obj as THREE.Mesh;
                if (geometry.index && geometry.index.count > 0) {
                    this.objectIndexBufferCache.set(obj, new IndexBuffer(device, geometry));
                }
            }
            return this.objectIndexBufferCache.get(obj);
        }
    }

    drawScene(scene: THREE.Scene, camera: THREE.Camera) {
        const { device, context, renderPassDescriptor } = this;

        this.ssao.renderPassDescriptor.colorAttachments[0].view = renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
        // this.ssao.renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

        const encoder = device.createCommandEncoder({ label: 'draw scene encoder' });
        const mainPass = encoder.beginRenderPass(renderPassDescriptor);
        mainPass.setPipeline(this.default_pipeline);
        mainPass.setBindGroup(0, this.entityMgr.bindGroup);
        scene.updateMatrixWorld();
        // this.entityMgr.matrixBuffer.update();
        mainPass.setBindGroup(1, this.updateCameraBuffer(camera).bindGroup);

        mainPass.pushDebugGroup('indirect draw batch');
        scene.traverse(obj => {
            if (obj instanceof THREE.Mesh) {
                if (!obj?.visible) {
                    return;
                }
                if (obj.onBeforeRender) {
                    obj.onBeforeRender(null, null, null, null, null, null);
                }

                const entity = this.entityMgr.updateObject(obj);

                if (entity) {
                    // mainPass.draw(
                    //     entity.indexCount,
                    //     1,
                    //     entity.indexOffset,
                    //     entity.objectId % 4,
                    // );

                    // mainPass.drawIndirect(this.entityMgr.batchBuffer.buffer, entity.objectId * 4 * 4);
                    mainPass.drawIndirect(this.entityMgr.batchBuffer.buffer, entity.objectId * 4 * IndirectBuffer.isize);
                }

                // const bindGroup = this.getObjectBindGroup(obj, camera);
                // if (bindGroup) {
                //     mainPass.setBindGroup(0, bindGroup);
                // }
                // const vertexBuffers = this.getObjectVertexBuffer(obj);
                // if (vertexBuffers) {
                //     vertexBuffers.forEach((vbo, i) => {
                //         mainPass.setVertexBuffer(i, vbo.buffer);
                //     });
                // }
                // const indexBuffer = this.getObjectIndexBuffer(obj);
                // if (indexBuffer) {
                //     mainPass.setIndexBuffer(indexBuffer.buffer, 'uint16');
                //     mainPass.drawIndexed(indexBuffer.array.length, 1);
                // }
            }
        });
        mainPass.popDebugGroup();

        // mainPass.pushDebugGroup('ssao');
        // this.ssao.draw(mainPass);
        // mainPass.popDebugGroup();

        mainPass.end();
        // this.ssao.draw(encoder);

        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
    }

}