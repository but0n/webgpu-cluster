/// This code is a port of the original C++ code from meshoptimizer

import { TypedArray } from "three";

export type TriangleAdjacency = {
    counts: Uint32Array;
    offsets: Uint32Array;
    data: Uint32Array;
}

type IndexType = ArrayLike<number>;

const buildTriangleAdjacency = (indices: ArrayLike<number>, vertex_count: number) => {
    const indexCount = indices.length;
    const face_count = indexCount / 3;

    const adjacency: TriangleAdjacency = {
        counts: new Uint32Array(vertex_count),
        offsets: new Uint32Array(vertex_count),
        data: new Uint32Array(indexCount),
    }

    // Count the number of faces adjacent to each vertex
    for (let i = 0; i < indexCount; i++) {
        adjacency.counts[indices[i]]++;
    }

    // Calculate the offset for each vertex
    let offset = 0;
    for (let i = 0; i < vertex_count; i++) {
        adjacency.offsets[i] = offset;
        offset += adjacency.counts[i];
    }

    if (offset !== indexCount) {
        throw new Error("Invalid offset");
    }

    // Assign the face id to vertex slots
    for (let i = 0; i < face_count; i++) {
        const i3 = i * 3;
        const v0 = indices[i3];
        const v1 = indices[i3 + 1];
        const v2 = indices[i3 + 2];

        // data[v_offset++] = face id
        adjacency.data[adjacency.offsets[v0]++] = i;
        adjacency.data[adjacency.offsets[v1]++] = i;
        adjacency.data[adjacency.offsets[v2]++] = i;
    }

    // Reset the offset
    for (let i = 0; i < vertex_count; i++) {
        adjacency.offsets[i] -= adjacency.counts[i];
    }

    return adjacency;
}

class Cone {
    // static keys = ['px', 'py', 'pz', 'nx', 'ny', 'nz'];
    pos: number[];
    constructor(
        px: number,
        py: number,
        pz: number,
        public nx: number,
        public ny: number,
        public nz: number,
        public area: number,
    ) {
        this.pos = [px, py, pz];
    }

    static reset(cone: Cone) {
        cone.pos.fill(0);
        cone.nx = 0;
        cone.ny = 0;
        cone.nz = 0;
        cone.area = 0;
    }

    static clone(cone: Cone) {
        return new Cone(cone.pos[0], cone.pos[1], cone.pos[2], cone.nx, cone.ny, cone.nz, cone.area);
    }
}

const computeTriangleCones = (index: IndexType, position: Float32Array) => {
    const face_count = index.length / 3;
    const vertexStride = 3; // [x, y, z, <...>]
    let mesh_area = 0;
    const triangles = new Array<Cone>(face_count).fill(null).map((_, i) => {
        const i3 = i * 3;
        const v0_offset = vertexStride * index[i3];
        const v1_offset = vertexStride * index[i3 + 1];
        const v2_offset = vertexStride * index[i3 + 2];
        const v0 = position.subarray(v0_offset, v0_offset + vertexStride);
        const v1 = position.subarray(v1_offset, v1_offset + vertexStride);
        const v2 = position.subarray(v2_offset, v2_offset + vertexStride);

        const p10 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        const p20 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

        // cross product
        const nx = p10[1] * p20[2] - p10[2] * p20[1];
        const ny = p10[2] * p20[0] - p10[0] * p20[2];
        const nz = p10[0] * p20[1] - p10[1] * p20[0];

        // normalize
        // ||N|| = dot(N, N)^0.5
        const area = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const inv_area = area == 0 ? 0 : 1 / area;

        mesh_area += area;

        return new Cone(
            // centroid
            (v0[0] + v1[0] + v2[0]) / 3,
            (v0[1] + v1[1] + v2[1]) / 3,
            (v0[2] + v1[2] + v2[2]) / 3,
            // normal
            nx * inv_area,
            ny * inv_area,
            nz * inv_area,
            area,
        );
    });
    return { triangles, mesh_area };
}

const kdtreePartition = (cones: Cone[], indices: Uint32Array, axis: number, pivot: number) => {
    let m = 0;
    for (let i = 0; i < indices.length; i++) {
        const v = cones[indices[i]].pos[axis];
        // swap (m, i)
        [indices[m], indices[i]] = [indices[i], indices[m]];
        m += v < pivot ? 1 : 0;
    }
    return m;
}

class KDNode {
    index: number;
    children: number;

    constructor(
        public axis = 2,
        public split: number = null,
    ) {}
}

const kdtreeBuildLeaf = (node_id: number, nodes: KDNode[], indices: Uint32Array, count: number) => {
    if (node_id + count >= nodes.length) {
        throw new Error("Out of bounds [leaf node]");
    }
    const node = nodes[node_id] = new KDNode();
    node.axis = 3;
    node.index = indices[0]; // FIXME:
    node.children = count;

    for (let i = 1; i < count; i++) {
        const tail = nodes[node_id + i] = new KDNode();
        tail.index = indices[i];
        tail.axis = 3;
    }
    return node_id + count;
}

const kdtreeBuild = (offset: number, nodes:KDNode[], cones: Cone[], indices: Uint32Array, leaf_size: number) => {
    const count = indices.length;
    // return leaf node
    if (count <= leaf_size) {
        return kdtreeBuildLeaf(offset, nodes, indices, count);
    }

    let mean = [0, 0, 0];
    let vars = [0, 0, 0];
    let runc = 1, runs = 1;


    // Welford's algorithm
    for (let i = 0; i < count; i++, runc+=1, runs = 1/runc) {
        const cone = cones[indices[i]];
        cone.pos.forEach((pos, axis) => {
            const delta = pos - mean[axis];
            mean[axis] += delta * runs;
            vars[axis] += delta * (pos - mean[axis]);
        });
    }

    const axis = vars[0] >= vars[1] && vars[0] >= vars[2] ? 0 : vars[1] >= vars[2] ? 1 : 2;
    const split = mean[axis];

    const middle = kdtreePartition(cones, indices, axis, split);
    if (middle <= leaf_size / 2 || middle >= count - leaf_size / 2) {
        return kdtreeBuildLeaf(offset, nodes, indices, count);
    }

    const node = nodes[offset] = new KDNode(axis, split);

    // left subtree is right after the current node
    const next_node_id = kdtreeBuild(offset + 1, nodes, cones, indices.subarray(0, middle), leaf_size);

    node.children = next_node_id - offset - 1;

    return kdtreeBuild(next_node_id, nodes, cones, indices.subarray(middle, count), leaf_size);
}

const getClusterCone = (cone: Cone, triangle_count = 0) => {
    // FIXME: get cluster cone returns a new cone
    const result = Cone.clone(cone);
    const center_scale = triangle_count == 0 ? 0 : 1 / triangle_count;
    // pos /= triangle_count
    result.pos.forEach((_, i) => result.pos[i] *= center_scale);

    const axis_length = result.nx * result.nx + result.ny * result.ny + result.nz * result.nz;
    const axis_scale = axis_length == 0 ? 0 : 1 / Math.sqrt(axis_length);

    result.nx *= axis_scale;
    result.ny *= axis_scale;
    result.nz *= axis_scale;
    return result;
}

export class Cluster {
    constructor(
        public vertex_offset = 0,
        public triangle_offset = 0,
        public vertex_count = 0,
        public triangle_count = 0,
    ) {}

    clone() {
        return new Cluster(this.vertex_offset, this.triangle_offset, this.vertex_count, this.triangle_count);
    }
}

export const buildCluster = (positions: Float32Array, indices: IndexType, max_vertices = 64, max_triangles = 124, cone_weight = 0) => {
    const vertex_count = positions.length / 3;
    const face_count = indices.length / 3;

    const adjacency = buildTriangleAdjacency(indices, vertex_count);

    // max_vertices = 1024;
    max_triangles = face_count / 618;
    max_vertices = max_triangles * 3;

    console.log({ max_vertices, max_triangles });
    // max_triangles = 256;

    // Cone
    const { triangles, mesh_area } = computeTriangleCones(indices, positions);
    // assuming each cluster is a square
    const triangle_area_avg = mesh_area / face_count * 0.5;
    const cluster_expect_radius = Math.sqrt(triangle_area_avg * max_triangles) * 0.5;

    // build kd-tree
    const kd_indices = new Uint32Array(new Array(face_count).fill(null).map((_, i) => i));
    const nodes = new Array<KDNode>(face_count * 2);

    kdtreeBuild(0, nodes, triangles, kd_indices, /* leaf size */ 8);

    // index of the vertex in the cluster
    const cluster = new Cluster();
    const clusters: Cluster[] = [];
    let cluster_offset = 0;
    const used = new Array(vertex_count).fill(0xff);
    const cluster_cone_acc = new Cone(0, 0, 0, 0, 0, 0, 0);
    // TODO:
    // const cluster_vertices: Uint32Array = new Uint32Array(vertex_count * 2);
    // const cluster_triangles: Uint32Array = new Uint32Array(indices.length * 2);
    const cluster_vertices: number[] = [];
    const cluster_triangles: number[] = [];
    const live_triangles = adjacency.counts.slice();

    const cluster_cones: Cone[] = [];

    const emitted_flags: boolean[] = new Array(face_count).fill(false);
    for (let i = 0; i < 1e9; i++) {
        // console.log('cluster ', cluster_offset);
        const cluster_cone = getClusterCone(cluster_cone_acc, cluster.triangle_count);
        // NOTE: cluster_cone is a new instance
        let { best_triangle, best_extra } = getNeighborTriangle(
            cluster,
            cluster_cone,
            cluster_vertices,
            indices,
            adjacency,
            triangles,
            live_triangles,
            used,
            cluster_expect_radius,
            cone_weight,
        );

        if (best_triangle != null && ((cluster.vertex_count + best_extra) > max_vertices || cluster.triangle_count >= max_triangles)) {
            // TODO:
            best_triangle = getNeighborTriangle(
                cluster,
                null,
                cluster_vertices,
                indices,
                adjacency,
                triangles,
                live_triangles,
                used,
                cluster_expect_radius,
                0,
            ).best_triangle;
        }

        if (best_triangle == null) {
            const result = {
                position: cluster_cone.pos,
                index: null,
                limit: Infinity,
            }
            kdtreeNearest(nodes, 0, triangles, emitted_flags, result);

            best_triangle = result.index;
        }

        if (best_triangle == null) {
            cluster_cones.push(Cone.clone(cluster_cone));
            break;
        }

        const indices_offset = best_triangle * 3;
        const a = indices[indices_offset];
        const b = indices[indices_offset + 1];
        const c = indices[indices_offset + 2];

        if (appendCluster(cluster, a, b, c, used, clusters, cluster_vertices, cluster_triangles, cluster_offset, max_vertices, max_triangles)) {
            cluster_offset++;
            cluster_cones.push(Cone.clone(cluster_cone));
            Cone.reset(cluster_cone_acc);
        }

        live_triangles[a]--;
        live_triangles[b]--;
        live_triangles[c]--;

        // remove emitted triangle from adjacency data
        // this makes sure that we spend less time traversing these lists on subsequent iterations
        for (let k = 0; k < 3; k++) {
            const index = indices[best_triangle * 3 + k];
            const neighbors = adjacency.data.subarray(adjacency.offsets[index], adjacency.offsets[index] + adjacency.counts[index]);
            for (let i = 0; i < neighbors.length; i++) {
                const tri = neighbors[i];
                if (tri === best_triangle) {
                    neighbors[i] = neighbors[neighbors.length - 1];
                    adjacency.counts[index]--;
                    break;
                }
            }
        }

        // update aggregated meshlet cone data for scoring subsequent triangles
        cluster_cone_acc.pos[0] += triangles[best_triangle].pos[0];
        cluster_cone_acc.pos[1] += triangles[best_triangle].pos[1];
        cluster_cone_acc.pos[2] += triangles[best_triangle].pos[2];
        cluster_cone_acc.nx += triangles[best_triangle].nx;
        cluster_cone_acc.ny += triangles[best_triangle].ny;
        cluster_cone_acc.nz += triangles[best_triangle].nz;

        cluster_cone_acc.area += triangles[best_triangle].area; // TODO: unnecessary

        emitted_flags[best_triangle] = true;
    }

    if (cluster.triangle_count) {
        // finishCluster
        clusters[cluster_offset++] = cluster.clone();
    }

    return {
        adjacency, triangles, nodes, kd_indices, clusters, cluster_offset, cluster_vertices, cluster_triangles, cluster_cones,
    }
}

// const buildClustersBound = (index_count: number, max_vertices: number, max_triangles: number) => {
// }

const finishCluster = (cluster: Cluster, cluster_triangles: number[]) => {
    let offset = cluster.triangle_offset + cluster.triangle_count * 3;
    // fill 4b padding with 0
    while (offset & 3)
        cluster_triangles[offset++] = 0;
}
const appendCluster = (cluster: Cluster, a: number, b: number, c: number, used: number[], clusters: Cluster[], cluster_vertices: number[], cluster_triangles: number[], cluster_offset: number, max_vertices: number, max_triangles: number) => {
    let av = used[a];
    let bv = used[b];
    let cv = used[c];

    let result = false;

    const used_extra = Number(av == 0xff) + Number(bv == 0xff) + Number(cv == 0xff);

    if ((cluster.vertex_count + used_extra) > max_vertices || cluster.triangle_count >= max_triangles) {
        clusters[cluster_offset] = cluster.clone();
        for (let j = 0; j < cluster.vertex_count; j++) {
            used[cluster_vertices[cluster.vertex_offset + j]] = 0xff;
        }
        // finishCluster(cluster, cluster_triangles); FIXME: no need for padding

        cluster.vertex_offset += cluster.vertex_count;
        cluster.triangle_offset += (cluster.triangle_count * 3); // TODO: 4b padding
        cluster.vertex_count = 0;
        cluster.triangle_count = 0;

        result = true;
    }

    if (av == 0xff) {
        av = cluster.vertex_count;
        cluster_vertices[cluster.vertex_offset + cluster.vertex_count++] = a;
    }
    if (bv == 0xff) {
        bv = cluster.vertex_count;
        cluster_vertices[cluster.vertex_offset + cluster.vertex_count++] = b;
    }
    if (cv == 0xff) {
        cv = cluster.vertex_count;
        cluster_vertices[cluster.vertex_offset + cluster.vertex_count++] = c;
    }

    cluster_triangles[cluster.triangle_offset + cluster.triangle_count * 3 + 0] = av;
    cluster_triangles[cluster.triangle_offset + cluster.triangle_count * 3 + 1] = bv;
    cluster_triangles[cluster.triangle_offset + cluster.triangle_count * 3 + 2] = cv;
    cluster.triangle_count++;

    return result;
}

const kdtreeNearest = (nodes: KDNode[], root: number, triangles: Cone[], emitted_flags: boolean[], result: { position: number[], index: number, limit: number }) => {
    const {
        position,
        limit,
    } = result;

    const node = nodes[root];
    if (node.axis == 3) {
        // leaf
        for (let i = 0; i < node.children; i++) {
            const { index } = nodes[root + i];
            if (emitted_flags[index])
                continue;

            const point = triangles[index].pos;
            const distance2 =
                (point[0] - position[0]) ** 2 +
                (point[1] - position[1]) ** 2 +
                (point[2] - position[2]) ** 2;

            const distance = Math.sqrt(distance2); // TODO: use distance2
            if (distance < limit) {
                result.index = index;
                result.limit = distance;
            }
        }
    } else {
        // branch; we order recursion to process the node that search position is in first
        const delta = position[node.axis] - node.split;
        const first = delta <= 0 ? 0 : node.children;
        const second = first ^ node.children;

        kdtreeNearest(nodes, root + 1 + first, triangles, emitted_flags, result);

        // only process the other node if it can have a match based on closest distance so far
        if (Math.abs(delta) < limit) {
            kdtreeNearest(nodes, root + 1 + second, triangles, emitted_flags, result);
        }
    }
}

const getNeighborTriangle = (
    cluster: Cluster,
    cluster_cone: Cone,
    cluster_vertices: ArrayLike<number>,
    indices: ArrayLike<number>,
    adjacency: TriangleAdjacency,
    triangles: Cone[],
    live_triangles: Uint32Array,
    used: number[],
    cluster_expected_radius: number,
    cone_weight: number,
    // out_extra = 0,
) => {
    let best_triangle = null;
    let best_extra = 5;
    let best_score = Infinity;

    for (let i = 0; i < cluster.triangle_count; i++) {
        const index = cluster_vertices[cluster.vertex_offset + i];
        // get triangle id from adjacency slot
        const neighbors_offset = adjacency.offsets[index];
        const neighbors = adjacency.data.subarray(neighbors_offset, neighbors_offset + adjacency.counts[index]);
        neighbors.forEach((triangle) => {
            const indices_offset = triangle * 3;
            const a = indices[indices_offset];
            const b = indices[indices_offset + 1];
            const c = indices[indices_offset + 2];
            let extra = Number(used[a] == 0xff) + Number(used[b] == 0xff) + Number(used[c] == 0xff);
            if (extra !== 0) {
                if (live_triangles[a] == 1 || live_triangles[b] == 1 || live_triangles[c] == 1) {
                    extra = 0;
                }
                extra++;
            }
            if (extra > best_extra)
                return; // continue

            let score = 0;
            if (cluster_cone) {
                const tri_cone = triangles[triangle];
                // distance squared
                const distance2 =
                    (tri_cone.pos[0] - cluster_cone.pos[0]) ** 2 +
                    (tri_cone.pos[1] - cluster_cone.pos[1]) ** 2 +
                    (tri_cone.pos[2] - cluster_cone.pos[2]) ** 2;
                // dot product
                const spread = tri_cone.nx * cluster_cone.nx + tri_cone.ny * cluster_cone.ny + tri_cone.nz * cluster_cone.nz;
                score = getClusterScore(distance2, spread, cone_weight, cluster_expected_radius);
            } else {
                score = live_triangles[a] + live_triangles[b] + live_triangles[c] - 3;
            }

            if (extra < best_extra || score < best_score) {
                best_triangle = triangle;
                best_extra = extra;
                best_score= score;
            }
        });
    }

    return {
        best_triangle,
        best_extra,
    };

}

const getClusterScore = (distance2: number, spread: number, cone_weight: number, expected_radius: number) => {
    const cone = 1 - spread * cone_weight;
    const cone_clamped = Math.max(cone, 1e-3); // TODO:
    return (1 + Math.sqrt(distance2) / expected_radius * (1 - cone_weight)) * cone_clamped;
}

const hashUpdate4 = (h: number, key: DataView, offset: number, len: number) => {
    const m = 0x5bd1e995;
    const r = 24;
    while(len >= 4) {
        let k = key.getUint32(offset, true);
        k *= m;
        k ^= k >> r;
        k *= m;
        h *= m;
        h ^= k;
        offset += 4;
        len -= 4;
    }
    return h;
}

export const vertexRemap = (indices: TypedArray, vertices: Float32Array, vertex_stride: number) => {
    const remap = [];
    const vertex_view = new DataView(vertices.buffer);
    let next_vertex = 0;
    const hashMap = new Map<number, number>();

    const vertex_count = vertices.byteLength / vertex_stride;

    for (let i = 0; i < vertex_count; i++) {
        const index = indices[i];
        const offset = index * vertex_stride;
        if (remap[index] == null) {
            // const hash = -1;
            const hash = hashUpdate4(0, vertex_view, offset, vertex_stride);
            if (hashMap.has(hash)) {
                remap[index] = hashMap.get(hash);
            } else {
                remap[index] = next_vertex++;
                hashMap.set(hash, index);
            }
        }
    }
    debugger
    return remap;
}
