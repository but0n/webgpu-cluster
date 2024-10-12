struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) vpos: vec3f,
    // @location(0) color: vec3f,
    @location(1) normal: vec3f,
};

// struct Vertex {
//     position: vec3f,
//     // normal: vec3f,
// };

// struct Vertex {
//     @location(0) position: vec3f,
//     @location(1) normal: vec3f,
//     // @location(1) color: vec3f,
//     // @location(2) offset: vec3f,
// }

// @group(1) @binding(0) var<uniform> VP: mat4x4f;
// @group(0) @binding(1) var<uniform> M: mat4x4f;

@group(0) @binding(0) var<storage, read> Matrices: array<mat4x4f>;
@group(0) @binding(1) var<storage, read> VertexBuffer: array<f32>;
@group(0) @binding(2) var<storage, read> IndexBuffer: array<u32>;

@group(1) @binding(0) var<uniform> VP: mat4x4f;


// @vertex fn vs(
//     // vert: Vertex,
//     @builtin(vertex_index) vertexIndex: u32,
//     @builtin(instance_index) instanceIndex: u32
// ) -> VSOutput {
//     var vsOutput: VSOutput;
//     // vsOutput.position = VP * M * vec4f(vert.position, 1);
//     // vsOutput.position = VP * M * vec4f(1);
//     vsOutput.position = vec4f(1);
//     // vsOutput.position /= vsOutput.position.w;
//     vsOutput.vpos = (Matrices[vertexIndex] * vec4f(vsOutput.position.xyz, 1)).xyz;
//     // vsOutput.color = color[vertexIndex];
//     var m = VertexBuffer[vertexIndex];
//     var mm = IndexBuffer[vertexIndex];
//     // vsOutput.normal = vert.normal;
//     vsOutput.normal = vec3f(1);
//     return vsOutput;
// }

fn pal( t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f ) -> vec3f {
    return a + b*cos( 6.28318*(c*t+d) );
}

@vertex fn vs(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VSOutput {
    var vsOutput: VSOutput;
    vsOutput.position = vec4f(1);
    var index = IndexBuffer[vertexIndex];
    var model: mat4x4f = Matrices[instanceIndex];
    var vert = vec3f(VertexBuffer[index * 6], VertexBuffer[index * 6 + 1], VertexBuffer[index * 6 + 2]);
    var pos = VP * model * vec4f(vert, 1);
    var normal = vec3f(VertexBuffer[index * 6 + 3], VertexBuffer[index * 6 + 4], VertexBuffer[index * 6 + 5]);
    // var m = VertexBuffer[vertexIndex];

    vsOutput.position = pos;
    var id = f32(instanceIndex) / 1.;
    // vsOutput.vpos = pal(f32(instanceIndex) / 8., vec3(0.8,0.5,0.4),vec3(0.2,0.4,0.2),vec3(2.0,1.0,1.0),vec3(0.0,0.25,0.25));
    // vsOutput.vpos = pal( f32(instanceIndex) / 5., vec3(0.8,0.5,0.4),vec3(0.2,0.4,0.2),vec3(2.0,1.0,1.0),vec3(0.0,0.25,0.25));
    // vsOutput.vpos = vec3f(sin(id * 3.1415926 / 2.), sin(id * 3.1415926), cos(id * 3.1415926 / 2.));

    if (f32(instanceIndex) >= 0) {
        vsOutput.vpos = .5 + .5 * cos(id + vec3f(1, 2, 4));
    }
    vsOutput.normal = normal;
    return vsOutput;
}

@fragment fn fs(vsdata: VSOutput) -> @location(0) vec4f {
    // return vec4f(pow(vsdata.color, vec3f(1/2.2)), 1);
    // return vec4f(pow(vsdata.vpos, vec3f(1/2.2)), 1);
    // return vec4f((vsdata.vpos + vsdata.color) * dot(vsdata.normal, vec3f(0, 1, 0)), 1);
    var color = vsdata.vpos;
    let NoL:f32 = max(0.05, dot(vsdata.normal, normalize(vec3f(1, 0, 1)))) * 2.;
    // color *= vec3f(NoL);
    // return vec4f(pow(color, vec3f(1./2.2)), 1.);
    return vec4f(color * NoL, .2);
    // return vec4f(pow(vsdata.position.xyz * .01, vec3f(1/2.2)), 1);
}
@fragment fn wire_fs(vsdata: VSOutput) -> @location(0) vec4f {
    return vec4f(1);
}
