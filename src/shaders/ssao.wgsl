struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) vpos: vec3f,
};

@group(0) @binding(0) var ourSampler: sampler;
@group(0) @binding(1) var base: texture_depth_2d;


@vertex fn vs(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VSOutput {
    let pos = array(
        vec2f( 0.0,  0.5),  // top center
        vec2f(-0.5, -0.5),  // bottom left
        vec2f( 0.5, -0.5)   // bottom right
    );
    var vsOutput: VSOutput;
    vsOutput.position = vec4f(pos[vertexIndex], 0.0, 1.0);
    vsOutput.vpos = vsOutput.position.xyz;
    return vsOutput;
}

@fragment fn fs(fsInput: VSOutput) -> @location(0) vec4f {
    var texcoord = fsInput.vpos.xy * 0.5 + 0.5;
    var color = textureSample(base, ourSampler, texcoord);
    return vec4f(texcoord, 1, 1);
}
