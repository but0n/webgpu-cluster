import ssao_shader from './shaders/ssao.wgsl';

export class SSAO {
    pipeline: GPURenderPipeline;
    bind: GPUBindGroup;
    renderPassDescriptor: GPURenderPassDescriptor;
    constructor(private device: GPUDevice, format: GPUTextureFormat, depthTexture: GPUTexture) {
        const module = device.createShaderModule({
            label: 'ssao module',
            code: ssao_shader,
        });

        const pipeline = this.pipeline = device.createRenderPipeline({
            label: 'ssao pipeline',
            layout: 'auto',
            vertex: {
                module,
                entryPoint: 'vs',
                buffers: [],
            },
            fragment: {
                module,
                entryPoint: 'fs',
                targets: [
                    {
                        format,
                    }
                ]
            },
            depthStencil: {
                depthWriteEnabled: false,
                format: 'depth24plus-stencil8',
                depthCompare: 'always',
            }
        });

        this.renderPassDescriptor = {
            label: 'ssao pass descriptor',
            colorAttachments: [
                {
                    view: null,
                    clearValue: [0.1, 0.1, 0.1, 1],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        };


        this.bind = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: device.createSampler({
                    addressModeU: 'clamp-to-edge',
                    addressModeV: 'clamp-to-edge',
                    addressModeW: 'clamp-to-edge',
                    magFilter: 'linear',
                    minFilter: 'linear',
                    mipmapFilter: 'linear',
                }) },
                { binding: 1, resource: depthTexture.createView() },
            ]
        });
    }

    // draw(encoder: GPUCommandEncoder) {
    //     const pass = encoder.beginRenderPass(this.renderPassDescriptor);
    //     pass.setPipeline(this.pipeline);
    //     pass.setBindGroup(0, this.bind);
    //     pass.draw(3);
    //     pass.end();
    //     return pass;
    // }
    draw(pass: GPURenderPassEncoder) {
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bind);
        pass.draw(3);
    }
}